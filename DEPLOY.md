# 部署指南

## 快速部署

### 1. 创建 Worker

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers** → **创建 Worker**
3. 名称随意，如 `proxy-sub`
4. 粘贴 `worker.js` 代码
5. 点击 **部署**

### 2. 创建 KV 存储

1. Workers → 你的 Worker → **设置** → **变量**
2. 找到 **KV 命名空间绑定**
3. 添加：
   - 变量名: `PROXY_KV`
   - 命名空间: 新建一个，名称随意

### 3. 重新部署

代码中已绑定 KV，**重新部署**一次

### 4. 访问订阅

```
https://你的worker.名称.workers.dev/sub
```

---

## Wrangler CLI 部署（可选）

如果你有 Wrangler：

```bash
# 安装
npm install -g wrangler

# 登录
wrangler login

# 创建KV
wrangler kv:namespace create PROXY_KV

# 部署
wrangler deploy
```

---

## 配置定时更新

### 网页端

1. Worker → **触发器** → **添加 Cron 触发器**
2. 填入：`0 * * * *` （每小时）
3. 保存

### Wrangler

在 `wrangler.toml` 中取消注释：

```toml
[[triggers.cron]]
schedule = "0 * * * *"
```

---

## 常见问题

### Q: 代理很少？
A: 免费代理本身不稳定，Worker 跑一轮可能只剩几十个

### Q: 测速很慢？
A: 并发数设的保守(20个)，可以调 `MAX_CONCURRENT`

### Q: 地区识别不准？
A: 目前是简单IP段猜测，正式用建议接入 IP 地理库

### Q: 怎么查看代理列表？
A: 访问 `?format=json` 看原始数据

---

## 安全建议

1. **不要公开分享** — 避免被滥用
2. **加访问密钥** — 设置 `API_KEY`
3. **自己用就好** — 免费代理不稳定，不适合大量用户
