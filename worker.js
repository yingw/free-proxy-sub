/**
 * 免费代理订阅服务 - Cloudflare Worker
 * 
 * 功能：抓取、测速、生成Clash订阅
 * 特性：
 *   - 多源抓取
 *   - 自动测速过滤
 *   - 地区识别+排名命名
 *   - 智能代理池缓存
 */

const CONFIG = {
  // ========== 数据源 ==========
  SOURCES: [
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  ],
  
  // ========== 测速配置 ==========
  TEST_URL: 'https://httpbin.org/get',
  SPEED_TEST_URL: 'https://speed.cloudflare.com/__down?bytes=1000000',  // 1MB测速
  TIMEOUT: 5000,           // 超时ms
  MAX_PER_COUNTRY: 10,     // 每国家保留数
  MAX_CONCURRENT: 20,      // 并发数
  
  // ========== 安全过滤 ==========
  EXCLUDE_COUNTRIES: ['RU', 'CN', 'KP', 'IR', 'SY'],  // 排除国家
  BLACKLIST: [              // 黑名单IP段
    '192.168.',
    '10.',
    '172.16.',
    '127.',
    'localhost',
  ],
  
  // ========== 其他 ==========
  API_KEY: '',              // 访问密钥(可选)
  CACHE_TTL: 3600,         // 缓存时间(秒)
};

/**
 * 主入口
 */
export default {
  async fetch(request, env, ctx) {
    // 初始化KV
    if (env.PROXY_KV) {
      globalThis.PROXY_KV = env.PROXY_KV;
    }
    
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      });
    }
    
    // 解析参数
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'clash';
    const country = url.searchParams.get('country');
    const limit = parseInt(url.searchParams.get('limit')) || 0;
    const key = url.searchParams.get('key');
    
    // 验证密钥
    if (CONFIG.API_KEY && key !== CONFIG.API_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    // 手动触发更新
    const update = url.searchParams.get('update');
    if (update === '1') {
      const result = await fetchAndTest();
      await KV.put('proxies', JSON.stringify(result.valid), { 
        expirationTtl: CONFIG.CACHE_TTL 
      });
      await KV.put('test_stats', JSON.stringify(result.stats), { 
        expirationTtl: CONFIG.CACHE_TTL 
      });
      return jsonResponse({ 
        success: true, 
        totalFound: result.stats.totalFound,
        tested: result.stats.totalTested,
        valid: result.stats.validCount,
        failed: result.stats.failedCount,
        successRate: result.stats.successRate,
        duration: result.stats.duration + 'ms',
        timestamp: result.stats.endTime,
      });
    }
    
    // 查看状态
    if (url.pathname === '/status') {
      const proxies = await getProxies();
      const stats = await getTestStats();
      const details = await getTestDetails();
      const countries = {};
      for (const p of proxies) {
        countries[p.country] = (countries[p.country] || 0) + 1;
      }
      return jsonResponse({
        // 当前代理
        totalProxies: proxies.length,
        countries,
        // 测试统计
        testStats: stats ? {
          lastTest: stats.endTime,
          duration: stats.duration + 'ms',
          sources: stats.sources,
          totalFound: stats.totalFound,
          totalTested: stats.totalTested,
          validCount: stats.validCount,
          failedCount: stats.failedCount,
          successRate: stats.successRate,
          countries: stats.countries,
        } : null,
        // 完整测试详情
        testDetails: details,
        cache: CONFIG.CACHE_TTL + '秒',
      });
    }
    
    // 获取代理
    let proxies = await getProxies();
    
    // 筛选
    if (country) {
      proxies = proxies.filter(p => p.country === country.toUpperCase());
    }
    if (limit > 0) {
      proxies = proxies.slice(0, limit);
    }
    
    // 输出
    if (format === 'json') {
      return jsonResponse(proxies);
    }
    
    return clashResponse(proxies);
  },
};

/**
 * 获取代理列表（带缓存）
 */
async function getProxies() {
  const cached = await KV.get('proxies');
  if (cached) {
    return JSON.parse(cached);
  }
  
  // 重新抓取+测速
  const result = await fetchAndTest();
  await KV.put('proxies', JSON.stringify(result.valid), { 
    expirationTtl: CONFIG.CACHE_TTL 
  });
  await KV.put('test_stats', JSON.stringify(result.stats), { 
    expirationTtl: CONFIG.CACHE_TTL 
  });
  // 存储完整测试结果
  await KV.put('test_details', JSON.stringify(result.details), { 
    expirationTtl: CONFIG.CACHE_TTL 
  });
  
  return result.valid;
}

/**
 * 获取测试统计
 */
async function getTestStats() {
  const cached = await KV.get('test_stats');
  return cached ? JSON.parse(cached) : null;
}

/**
 * 获取测试详情
 */
async function getTestDetails() {
  const cached = await KV.get('test_details');
  return cached ? JSON.parse(cached) : null;
}

/**
 * 抓取并测速
 */
async function fetchAndTest() {
  const startTime = Date.now();
  console.log('开始抓取代理...');
  
  // 1. 抓取
  let rawProxies = [];
  for (const source of CONFIG.SOURCES) {
    try {
      const list = await fetchProxyList(source);
      rawProxies = [...rawProxies, ...list];
      console.log(`抓取成功: ${source}, ${list.length} 个`);
    } catch (e) {
      console.error(`抓取失败: ${source}`, e.message);
    }
  }
  
  // 去重
  rawProxies = [...new Set(rawProxies.map(p => `${p.server}:${p.port}`))]
    .map(s => {
      const [server, port] = s.split(':');
      return { server, port: parseInt(port), type: 'http' };
    });
  
  console.log(`共 ${rawProxies.length} 个代理`);
  
  // 2. 安全过滤
  rawProxies = rawProxies.filter(isSafeProxy);
  console.log(`安全过滤后 ${rawProxies.length} 个`);
  
  // 3. 批量查询地区
  const ips = rawProxies.map(p => p.server);
  const countries = await fetchCountriesBatch(ips);
  
  // 4. 测速
  const tested = await testProxies(rawProxies, countries);
  const valid = tested.filter(p => p.latency > 0);
  const failed = tested.filter(p => p.delay <= 0);
  
  console.log(`有效代理 ${valid.length} 个`);
  
  // 4. 综合评分+排名
  const scored = valid.map(p => ({
    ...p,
    score: Math.round((10000 / (p.latency + 100)) * (p.downloadSpeed + 1)),
  }));
  scored.sort((a, b) => b.score - a.score);
  const ranked = rankProxies(scored);
  
  // 统计信息
  const stats = {
    startTime: new Date(startTime).toISOString(),
    endTime: new Date().toISOString(),
    duration: Date.now() - startTime,
    sources: CONFIG.SOURCES.length,
    totalFound: rawProxies.length,
    totalTested: tested.length,
    validCount: valid.length,
    failedCount: failed.length,
    successRate: tested.length > 0 ? (valid.length / tested.length * 100).toFixed(1) + '%' : '0%',
    countries: {},
  };
  
  // 国家统计
  for (const p of valid) {
    stats.countries[p.country] = (stats.countries[p.country] || 0) + 1;
  }
  
  // 完整测试详情（包含成功和失败的）
  const details = tested.map(p => ({
    server: p.server,
    port: p.port,
    latency: p.latency,
    downloadSpeed: p.downloadSpeed,
    country: p.country,
    status: p.latency > 0 ? 'ok' : 'failed',
  }));
  
  return { valid: ranked, stats, details };
}

/**
 * 从URL抓取代理列表
 */
async function fetchProxyList(url) {
  const response = await fetch(url, { timeout: 10000 });
  const text = await response.text();
  
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l && l.includes(':'))
    .map(line => {
      const [server, port] = line.split(':');
      return { server, port: parseInt(port), type: 'http' };
    });
}

/**
 * 安全过滤
 */
function isSafeProxy(proxy) {
  // 黑名单
  for (const blocked of CONFIG.BLACKLIST) {
    if (proxy.server.startsWith(blocked)) return false;
  }
  // 端口
  if (proxy.port < 1 || proxy.port > 65535) return false;
  
  return true;
}

/**
 * 并发测速
 */
async function testProxies(proxies, countries = {}) {
  const results = [];
  
  for (let i = 0; i < proxies.length; i += CONFIG.MAX_CONCURRENT) {
    const batch = proxies.slice(i, i + CONFIG.MAX_CONCURRENT);
    const tested = await Promise.all(batch.map(p => testProxy(p, countries[p.server])));
    results.push(...tested);
    
    console.log(`测速进度: ${Math.min(i + CONFIG.MAX_CONCURRENT, proxies.length)}/${proxies.length}`);
    await new Promise(r => setTimeout(r, 100));  // 避免过快
  }
  
  return results;
}

/**
 * 测试单个代理
 */
async function testProxy(proxy, country = 'XX') {
  const start = Date.now();
  
  try {
    // 延迟测试
    await fetch(CONFIG.TEST_URL, {
      proxy: `http://${proxy.server}:${proxy.port}`,
      signal: AbortSignal.timeout(CONFIG.TIMEOUT),
    });
    const latency = Date.now() - start;
    
    // 下载测速
    let downloadSpeed = 0;
    try {
      const speedStart = Date.now();
      const resp = await fetch(CONFIG.SPEED_TEST_URL, {
        proxy: `http://${proxy.server}:${proxy.port}`,
        signal: AbortSignal.timeout(CONFIG.TIMEOUT),
      });
      await resp.arrayBuffer();
      const speedTime = Date.now() - speedStart;
      // 速度 = 1MB / 时间(秒)，单位 MB/s
      downloadSpeed = Math.round(1000 / speedTime * 10) / 10;
    } catch (e) {
      // 下载测速失败不影响
    }
    
    return {
      ...proxy,
      latency,
      downloadSpeed,
      country,
    };
  } catch (e) {
    return { ...proxy, latency: -1, downloadSpeed: 0, country };
  }
}

/**
 * IP 地理库缓存
 */
const geoCache = {};

/**
 * 查询 IP 地区（使用 ip-api.com）
 */
async function fetchCountry(ip) {
  if (geoCache[ip]) return geoCache[ip];
  
  try {
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`);
    const data = await resp.json();
    geoCache[ip] = data.countryCode || 'XX';
    return geoCache[ip];
  } catch (e) {
    return 'XX';
  }
}

/**
 * 批量查询 IP 地区（更高效）
 */
async function fetchCountriesBatch(ips) {
  if (ips.length === 0) return {};
  
  // 过滤已缓存
  const uncached = ips.filter(ip => !geoCache[ip]);
  if (uncached.length > 0) {
    try {
      // 批量查询最多 100 个
      const batch = uncached.slice(0, 100);
      const resp = await fetch('http://ip-api.com/batch?fields=query,countryCode', {
        method: 'POST',
        body: JSON.stringify(batch.map(ip => ({ query: ip }))),
      });
      const results = await resp.json();
      for (const r of results) {
        geoCache[r.query] = r.countryCode || 'XX';
      }
    } catch (e) {
      // 批量失败不影响
    }
  }
  
  // 返回结果
  const result = {};
  for (const ip of ips) {
    result[ip] = geoCache[ip] || 'XX';
  }
  return result;
}

/**
 * 按地区分组+排名命名
 */
function rankProxies(proxies) {
  // 分组
  const grouped = {};
  for (const p of proxies) {
    if (CONFIG.EXCLUDE_COUNTRIES.includes(p.country)) continue;
    const c = p.country || 'XX';
    (grouped[c] = grouped[c] || []).push(p);
  }
  
  // 排序+命名
  const result = [];
  for (const [country, list] of Object.entries(grouped)) {
    const sorted = list.sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = sorted.slice(0, CONFIG.MAX_PER_COUNTRY);
    
    top.forEach((p, i) => {
      result.push({
        ...p,
        name: `${country}-${String(i + 1).padStart(2, '0')}`,
      });
    });
  }
  
  return result;
}

/**
 * 生成Clash配置
 */
function generateClash(proxies) {
  let yaml = '# 免费代理订阅\n';
  yaml += `# 更新时间: ${new Date().toISOString()}\n\n`;
  
  // 代理列表
  yaml += 'proxies:\n';
  for (const p of proxies) {
    yaml += `  - name: "${p.name}"\n`;
    yaml += `    type: http\n`;
    yaml += `    server: ${p.server}\n`;
    yaml += `    port: ${p.port}\n`;
    if (p.latency > 0) yaml += `    latency: ${p.latency}\n`;
    if (p.downloadSpeed > 0) yaml += `    speed: ${p.downloadSpeed}MB/s\n`;
    yaml += '\n';
  }
  
  // 代理组
  const countries = [...new Set(proxies.map(p => p.country))].filter(c => c !== 'XX');
  if (countries.length > 0) {
    yaml += 'proxy-groups:\n';
    yaml += '  - name: "auto-proxy"\n';
    yaml += '    type: select\n';
    yaml += '    proxies:\n';
    for (const c of countries) {
      for (const p of proxies.filter(p => p.country === c)) {
        yaml += `      - ${p.name}\n`;
      }
    }
    yaml += '      - DIRECT\n';
  }
  
  return yaml;
}

// ========== 响应辅助 ==========

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function clashResponse(proxies) {
  return new Response(generateClash(proxies), {
    headers: { 
      'Content-Type': 'text/yaml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ========== KV 辅助 ==========
const KV = {
  async get(key) {
    try {
      return await PROXY_KV.get(key);
    } catch {
      return null;
    }
  },
  async put(key, value, options) {
    return PROXY_KV.put(key, value, options);
  },
};

// ========== 定时任务（可选）==========
export async function scheduled(event, env, ctx) {
  globalThis.PROXY_KV = env.PROXY_KV;
  const proxies = await fetchAndTest();
  await KV.put('proxies', JSON.stringify(proxies), { 
    expirationTtl: CONFIG.CACHE_TTL 
  });
}
