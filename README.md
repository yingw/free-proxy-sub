# 免费代理订阅服务

> 自动抓取、测速、转换格式的免费代理订阅服务

## 功能特性

- 🌐 **多源抓取** - 自动从多个公开代理列表抓取
- ⚡ **自动测速** - 并发测速，过滤无效代理
- 🌍 **地区识别** - 自动识别代理所属地区
- 📊 **智能排序** - 按延迟排序，按地区+排名命名
- 🔒 **安全筛选** - HTTPS代理优先，黑名单过滤
- ⏰ **定时更新** - 支持Cron自动刷新
- 📱 **多格式输出** - 支持 Clash / JSON 格式

## 订阅地址

部署后访问：
```
https://your-worker.your-subdomain.workers.dev/sub
```

### 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `format` | 输出格式 | `clash`(默认), `json` |
| `country` | 筛选国家 | `US`, `JP`, `CN` |
| `limit` | 限制数量 | `10`, `20` |
| `key` | 访问密钥 | (可选) |

### 示例

```bash
# 默认Clash格式
/sub

# 只看美国代理
/sub?country=US

# 只取前10个
/sub?limit=10

# JSON格式
/sub?format=json
```

## 代理命名规则

代理按 **地区-排名** 命名：

```
US-01  → 延迟最低的美国代理
US-02  → 延迟第二低的美国代理
JP-01  → 延迟最低的日本代理
...
```

**好处**：下次更新后名称不变，你选 US-01 就不用重新选

## 部署

### 1. 创建 KV 命名空间

```bash
wrangler kv:namespace create PROXY_KV
```

### 2. 部署

```bash
wrangler deploy
```

### 3. 配置定时更新（可选）

在 `wrangler.toml` 取消注释定时任务：

```toml
[[triggers.cron]]
schedule = "0 * * * *"  # 每小时
```

## 本地开发

```bash
# 安装依赖
npm install -g wrangler

# 登录
wrangler login

# 本地测试
wrangler dev

# 部署
wrangler deploy
```

## 配置

编辑 `worker.js` 或创建 `config.js`：

```javascript
const CONFIG = {
  // 代理数据源
  SOURCES: [
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  ],
  
  // 测速
  TEST_URL: 'https://httpbin.org/get',
  TIMEOUT: 5000,
  
  // 每个国家保留数量
  MAX_PER_COUNTRY: 10,
  
  // 排除国家（安全）
  EXCLUDE_COUNTRIES: ['RU', 'CN', 'KP'],
  
  // 访问密钥
  API_KEY: '',
};
```

## 输出格式

### Clash 订阅

```yaml
proxies:
  - name: "US-01"
    type: http
    server: 1.2.3.4
    port: 8080
    delay: 120
  - name: "JP-01"
    type: http
    server: 5.6.7.8
    port: 3128
    delay: 150

proxy-groups:
  - name: "auto-proxy"
    type: select
    proxies:
      - US-01
      - US-02
      - JP-01
      - DIRECT
```

### JSON

```json
[
  {
    "name": "US-01",
    "server": "1.2.3.4",
    "port": 8080,
    "type": "http",
    "country": "US",
    "delay": 120
  }
]
```

## 目录结构

```
free-proxy-sub/
├── worker.js          # 主代码
├── wrangler.toml      # 部署配置
├── config.example.js  # 配置示例
├── README.md          # 说明文档
├── DEPLOY.md         # 部署指南
└── .gitignore
```

## 安全说明

- 只保留 HTTPS 代理（加密流量）
- 过滤已知恶意IP段
- 不记录敏感日志

## TODO

- [ ] 代理池（复用历史测试结果）
- [ ] 更精确的IP地区识别
- [ ] 自动重试失败代理
- [ ] 统计面板

## 参考

- [Clash配置](https://github.com/Dreamacro/clash/wiki/configuration)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [代理数据源](https://github.com/TheSpeedX/PROXY-List)
