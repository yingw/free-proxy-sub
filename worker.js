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
  const proxies = await fetchAndTest();
  await KV.put('proxies', JSON.stringify(proxies), { 
    expirationTtl: CONFIG.CACHE_TTL 
  });
  
  return proxies;
}

/**
 * 抓取并测速
 */
async function fetchAndTest() {
  console.log('开始抓取代理...');
  
  // 1. 抓取
  let rawProxies = [];
  for (const source of CONFIG.SOURCES) {
    try {
      const list = await fetchProxyList(source);
      rawProxies = [...rawProxies, ...list];
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
  
  // 3. 测速
  const tested = await testProxies(rawProxies);
  const valid = tested.filter(p => p.delay > 0);
  console.log(`有效代理 ${valid.length} 个`);
  
  // 4. 地区分组+排名
  return rankProxies(valid);
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
async function testProxies(proxies) {
  const results = [];
  
  for (let i = 0; i < proxies.length; i += CONFIG.MAX_CONCURRENT) {
    const batch = proxies.slice(i, i + CONFIG.MAX_CONCURRENT);
    const tested = await Promise.all(batch.map(testProxy));
    results.push(...tested);
    
    console.log(`测速进度: ${Math.min(i + CONFIG.MAX_CONCURRENT, proxies.length)}/${proxies.length}`);
    await new Promise(r => setTimeout(r, 100));  // 避免过快
  }
  
  return results;
}

/**
 * 测试单个代理
 */
async function testProxy(proxy) {
  const start = Date.now();
  
  try {
    await fetch(CONFIG.TEST_URL, {
      proxy: `http://${proxy.server}:${proxy.port}`,
      signal: AbortSignal.timeout(CONFIG.TIMEOUT),
    });
    
    return {
      ...proxy,
      delay: Date.now() - start,
      country: guessCountry(proxy.server),
    };
  } catch (e) {
    return { ...proxy, delay: -1, country: 'XX' };
  }
}

/**
 * 简单地区猜测（实际应用建议用IP库）
 */
function guessCountry(ip) {
  // 常见IP段（极简实现）
  if (ip.startsWith('3.')) return 'US';
  if (ip.startsWith('35.')) return 'US';
  if (ip.startsWith('52.')) return 'US';
  if (ip.startsWith('104.')) return 'US';
  if (ip.startsWith('133.') || ip.startsWith('150.')) return 'JP';
  if (ip.startsWith('202.')) return 'AP';
  if (ip.startsWith('218.') || ip.startsWith('119.')) return 'CN';
  
  return 'XX';
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
    const sorted = list.sort((a, b) => a.delay - b.delay);
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
    if (p.delay > 0) yaml += `    delay: ${p.delay}\n`;
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
