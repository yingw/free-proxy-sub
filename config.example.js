/**
 * 配置文件
 * 使用前请复制为 config.js 并修改配置
 */

const CONFIG = {
  // 代理列表数据源（可添加更多）
  SOURCES: [
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    // 可以添加更多来源...
  ],
  
  // 测速目标URL
  TEST_URL: 'https://httpbin.org/get',
  
  // 超时时间（毫秒）
  TIMEOUT: 5000,
  
  // 每个国家保留的代理数量
  MAX_PER_COUNTRY: 10,
  
  // 排除的国家（安全考虑）
  EXCLUDE_COUNTRIES: ['RU', 'CN', 'KP', 'IR', 'SY'],
  
  // 访问密钥（可选，设置后访问需要带 ?key=xxx）
  API_KEY: '',
};

module.exports = CONFIG;
