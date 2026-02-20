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
  // free-proxy-list.net: 页面抓取，每30分钟更新，支持Google筛选 (FP源)
  // 66代理: 国内高匿名代理 (66源)
  // proxifly: 3862 stars (备用)
  SOURCES: [
    'https://free-proxy-list.net/',
    'https://free-proxy-list.net/zh-cn/',
    'https://free-proxy-list.net/ssl-proxy.html',
    'https://free-proxy-list.net/zh-cn/ssl-proxy.html',
    { url: 'http://api.66daili.com/?anonymity=%E9%AB%98%E5%8C%BF&protocol=HTTPS&format=json', type: 'json66' },
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

// ========== 国家代码映射 ==========
const countryNames = {
  'US': '美国', 'CN': '中国', 'JP': '日本', 'KR': '韩国',
  'GB': '英国', 'DE': '德国', 'FR': '法国', 'RU': '俄罗斯',
  'IN': '印度', 'BR': '巴西', 'CA': '加拿大', 'AU': '澳大利亚',
  'IT': '意大利', 'ES': '西班牙', 'NL': '荷兰', 'SE': '瑞典',
  'TW': '台湾', 'HK': '香港', 'SG': '新加坡', 'ID': '印尼',
  'MY': '马来西亚', 'TH': '泰国', 'VN': '越南', 'PH': '菲律宾',
  'FI': '芬兰', 'PL': '波兰', 'UA': '乌克兰', 'TR': '土耳其',
  'AR': '阿根廷', 'MX': '墨西哥', 'CL': '智利', 'CO': '哥伦比亚',
  'PE': '秘鲁', 'EC': '厄瓜多尔', 'VE': '委内瑞拉', 'BO': '玻利维亚',
  'PY': '巴拉圭', 'UY': '乌拉圭', 'CR': '哥斯达黎加', 'PA': '巴拿马',
  'DO': '多米尼加', 'GT': '危地马拉', 'HN': '洪都拉斯', 'SV': '萨尔瓦多',
  'NI': '尼加拉瓜', 'JM': '牙买加', 'TT': '特立尼达', 'BS': '巴哈马',
  'BH': '巴林', 'SA': '沙特', 'AE': '阿联酋', 'IL': '以色列',
  'IQ': '伊拉克', 'IR': '伊朗', 'PK': '巴基斯坦', 'BD': '孟加拉国',
  'LK': '斯里兰卡', 'NP': '尼泊尔', 'MM': '缅甸', 'KH': '柬埔寨',
  'LA': '老挝', 'MN': '蒙古', 'NZ': '新西兰', 'ZA': '南非',
  'EG': '埃及', 'NG': '尼日利亚', 'KE': '肯尼亚', 'MA': '摩洛哥',
  'GH': '加纳', 'TZ': '坦桑尼亚', 'ET': '埃塞俄比亚', 'DZ': '阿尔及利亚',
  'TN': '突尼斯', 'SN': '塞内加尔', 'ZW': '津巴布韦', 'LS': '莱索托',
  'UG': '乌干达', 'RW': '卢旺达', 'MU': '毛里求斯', 'SC': '塞舌尔',
  'BE': '比利时', 'CH': '瑞士', 'AT': '奥地利', 'PT': '葡萄牙',
  'IE': '爱尔兰', 'NO': '挪威', 'DK': '丹麦', 'IS': '冰岛',
  'CZ': '捷克', 'HU': '匈牙利', 'RO': '罗马尼亚', 'BG': '保加利亚',
  'GR': '希腊', 'SK': '斯洛伐克', 'LT': '立陶宛', 'LV': '拉脱维亚',
  'EE': '爱沙尼亚', 'HR': '克罗地亚', 'RS': '塞尔维亚', 'BA': '波黑',
  'SI': '斯洛文尼亚', 'MK': '北马其顿', 'AL': '阿尔巴尼亚', 'ME': '黑山',
  'BY': '白俄罗斯', 'KZ': '哈萨克斯坦', 'UZ': '乌兹别克斯坦', 'KG': '吉尔吉斯斯坦',
  'AZ': '阿塞拜疆', 'GE': '格鲁吉亚', 'AM': '亚美尼亚', 'CY': '塞浦路斯',
  'LU': '卢森堡', 'MT': '马耳他', 'KY': '开曼群岛', 'PR': '波多黎各',
  'XX': '未知',
  '66': '66代理',
};

/**
 * 获取国家中文名
 */
function getCountryName(code) {
  return countryNames[code] || code;
}

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
    const source = url.searchParams.get('source');  // 筛选来源: FP, 66, 或 all
    
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
        sourceStats: result.stats.sourceStats,
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
    
    // 查看当前订阅的 Top 代理详情
    if (url.pathname === '/top') {
      const proxies = await getProxies();
      const limit = parseInt(url.searchParams.get('limit')) || 10;
      const topProxies = proxies.slice(0, limit);
      return jsonResponse({
        total: proxies.length,
        shown: topProxies.length,
        proxies: topProxies,
      });
    }
    
    // 获取代理
    let proxies = await getProxies();
    
    // 筛选来源
    if (source && source !== 'all') {
      proxies = proxies.filter(p => p.source === source);
    }
    // 筛选国家
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
  
  // 1. 抓取（分开处理）
  let rawProxies = [];      // 需要测速的（FP）
  let noTestProxies = [];  // 不需要测速的（66国内代理）
  
  for (const source of CONFIG.SOURCES) {
    try {
      const list = await fetchProxyList(source);
      // 判断是否是66代理（通过source type或URL判断）
      const is66 = typeof source === 'object' && source.type === 'json66';
      if (is66) {
        noTestProxies = [...noTestProxies, ...list];
        console.log(`[66] 不测速，直接使用 ${list.length} 个`);
      } else {
        rawProxies = [...rawProxies, ...list];
        console.log(`[FP] 抓取成功: ${list.length} 个`);
      }
    } catch (e) {
      console.error(`抓取失败: ${source}`, e.message);
    }
  }
  
  // 去重（分别处理）
  const fpSet = new Set(rawProxies.map(p => `${p.server}:${p.port}`));
  const allAddrs = new Set([...noTestProxies.map(p => `${p.server}:${p.port}`)]);
  
  rawProxies = [...fpSet].map(s => {
    const [server, port] = s.split(':');
    return { server, port: parseInt(port), type: 'http', source: 'FP' };
  });
  
  // 66代理去重后加入
  for (const s of allAddrs) {
    if (!fpSet.has(s)) {
      const [server, port] = s.split(':');
      noTestProxies.push({ server, port: parseInt(port), type: 'http', source: '66' });
    }
  }
  
  console.log(`共 ${rawProxies.length + noTestProxies.length} 个代理 (FP:${rawProxies.length}, 66:${noTestProxies.length})`);
  
  // 2. 安全过滤
  rawProxies = rawProxies.filter(isSafeProxy);
  console.log(`FP安全过滤后 ${rawProxies.length} 个`);
  
  // 3. 批量查询地区（仅FP）
  const ips = rawProxies.map(p => p.server);
  const countries = await fetchCountriesBatch(ips);
  
  // 4. 测速（仅FP）
  const tested = await testProxies(rawProxies, countries);
  const valid = tested.filter(p => p.latency > 0);
  const failed = tested.filter(p => p.latency <= 0);
  
  console.log(`FP有效代理 ${valid.length} 个`);
  
  // 5. 合并66代理（给一个默认延迟和分数，让它们也能用）
  for (const p of noTestProxies) {
    p.latency = 1000;  // 默认延迟
    p.downloadSpeed = 1;
    p.score = 100;  // 较低分数
    p.country = '66';  // 用66区分，不过滤
    valid.push(p);
  }
  console.log(`合并66代理后共 ${valid.length} 个`);
  
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
    sourceStats: {},  // 来源统计
  };
  
  // 来源统计
  for (const p of tested) {
    const src = p.source || 'FP';
    if (!stats.sourceStats[src]) {
      stats.sourceStats[src] = { found: 0, valid: 0, failed: 0 };
    }
    stats.sourceStats[src].found++;
    if (p.latency > 0) {
      stats.sourceStats[src].valid++;
    } else {
      stats.sourceStats[src].failed++;
    }
  }
  
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
    countryName: getCountryName(p.country),
    status: p.latency > 0 ? 'ok' : 'failed',
  }));
  
  return { valid: ranked, stats, details };
}

/**
 * 从URL抓取代理列表
 */
async function fetchProxyList(source) {
  // 支持两种格式：
  // 1. 字符串 URL (HTML页面)
  // 2. 对象 { url, type } (JSON API)
  const url = typeof source === 'string' ? source : source.url;
  const sourceType = typeof source === 'string' ? 'html' : source.type;
  
  const response = await fetch(url, { timeout: 10000 });
  
  // JSON API 格式（如66代理）
  if (sourceType === 'json66') {
    try {
      const json = await response.json();
      if (json.code === 0 && json.data) {
        const proxies = json.data.map(item => ({
          server: item.ip,
          port: parseInt(item.port),
          type: 'http',
          source: '66'  // 标记来源
        }));
        console.log(`[66代理] 抓取 ${proxies.length} 个代理`);
        return proxies;
      }
    } catch (e) {
      console.error(`[66代理] 解析失败:`, e.message);
    }
    return [];
  }
  
  // HTML 页面格式 (free-proxy-list.net)
  const text = await response.text();
  const trRegex = /<tr><td>([\d.]+)<\/td><td>(\d+)<\/td><td>([A-Z]{2})<\/td><td class='hm'>[^<]*<\/td><td>([^<]+)<\/td><td class='hm'>([^<]*)<\/td><td class='hx'>([^<]*)<\/td>/g;
  const proxies = [];
  let match;
  
  while ((match = trRegex.exec(text)) !== null) {
    const [, ip, port, code, anonymity, google, https] = match;
    const googleOk = google.trim() === 'yes';
    // 只保留支持Google的代理
    if (googleOk) {
      proxies.push({
        server: ip,
        port: parseInt(port),
        type: 'http',
        source: 'FP'  // 标记来源
      });
    }
  }
  
  // 如果不是HTML，则尝试普通格式
  if (proxies.length === 0) {
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l && l.includes(':'))
      .map(line => {
        let clean = line.replace(/^https?:\/\//, '');
        const [server, port] = clean.split(':');
        return { server, port: parseInt(port), type: 'http', source: 'FP' };
      });
  }
  
  console.log(`[FP] 抓取 ${proxies.length} 个支持Google的代理`);
  return proxies;
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
      const cnName = getCountryName(country);
      const prefix = p.source === '66' ? '66' : 'FP';  // 根据来源区分
      result.push({
        ...p,
        name: `${prefix}-${cnName}-${String(i + 1).padStart(2, '0')}`,
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
// 注意：PROXY_KV 需要在 Cloudflare Dashboard 的 Worker 设置中绑定
// 路径：Workers → 你的Worker → 设置 → 变量 → KV 命名空间绑定
const KV = {
  async get(key) {
    try {
      // 优先使用 env 传入的绑定，其次尝试 globalThis
      const kv = globalThis.PROXY_KV;
      return kv ? await kv.get(key) : null;
    } catch {
      return null;
    }
  },
  async put(key, value, options) {
    try {
      const kv = globalThis.PROXY_KV;
      if (kv) {
        return await kv.put(key, value, options);
      }
    } catch (e) {
      console.error('KV put error:', e);
    }
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
