# 七牛云作品集上传服务（Cloudflare Worker）

本 Worker 是 GitHub Pages 作品集的安全上传网关。图片、视频和作品清单均保存在七牛云 Kodo；网页通过本 Worker 读取作品清单，并申请限时、限范围的上传凭证。

## 七牛云配置

- 存储空间名称：`cheng-portfolio`
- 区域：华南
- 访问域名：`https://tn1fk7ro8.hn-bkt.clouddn.com`

在七牛云 Kodo 的跨域（CORS）设置中允许来源：

- `https://chengteli.github.io`

允许方法至少包括 `POST`、`PUT`、`GET`、`OPTIONS`，并允许请求头 `Authorization`、`Content-Type`、`X-Log`。如果控制台支持通配请求头，也可以按其建议配置。

## Cloudflare Worker 配置

Worker 变量（非敏感）：

- `QINIU_BUCKET` = `cheng-portfolio`
- `QINIU_DOMAIN` = `https://tn1fk7ro8.hn-bkt.clouddn.com`

必须配置为 **Encrypted secrets（加密密钥）**：

- `QINIU_ACCESS_KEY` = 七牛云 AccessKey
- `QINIU_SECRET_KEY` = 七牛云 SecretKey
- `ADMIN_PASSWORD` = 你自己设置的管理员登录密码
- `ADMIN_SESSION_SECRET` = 独立生成的长随机字符串，不能与管理员密码相同

不要把七牛云密钥或管理员密码写进 GitHub Pages 的 HTML、JSON 或公开仓库。

## 网页使用方式

1. 打开 https://chengteli.github.io/。
2. 点击右上角“管理入口”，输入 Worker 中配置的管理员密码。
3. 填写作品名称和说明，选择图片或视频；可以点击上传区域选文件，也可以把文件直接拖进去。
4. 点击“上传并保存作品”。网页会向 Worker 申请限时凭证，将文件上传到七牛云，再把作品清单保存为 `portfolio-data/site-data.json`。
5. 刷新网页，作品应仍然显示。管理端可以修改作品名称/说明，或从展示清单移除作品。

管理登录会话仅保存在当前浏览器标签页的 sessionStorage，退出登录或关闭标签页后需要重新登录。访客不显示管理操作。

## API 路由

- `GET /items`：从七牛云读取作品清单。
- `POST /admin-login`：使用管理员密码登录，返回 12 小时有效的签名会话。
- `POST /upload-token`：校验管理员会话，签发限定对象名、文件大小和 MIME 类型的上传凭证。
- `POST /data-token`：校验管理员会话，签发作品清单 JSON 的上传凭证。

网页只使用 Worker 返回的临时上传凭证，不接触七牛云 SecretKey。Worker 仅允许来源 `https://chengteli.github.io`。

## 大文件与故障排查

网页使用七牛云 JS SDK 的分片上传能力，适合较大的视频，但实际限制仍取决于七牛云账户、网络和浏览器。请先用一张小图片验证完整流程。

如果登录失败，检查 `ADMIN_PASSWORD` 与 `ADMIN_SESSION_SECRET` 是否已在当前 Worker 部署中配置。如果上传时报“服务未配置”，检查四个七牛云/管理员变量和加密密钥。如果上传成功但刷新后作品消失，检查 `/data-token` 路由、Kodo CORS、存储空间访问域名及 `portfolio-data/site-data.json` 是否已写入。

删除作品目前只会从展示清单中移除，不会删除七牛云中的原始文件，避免误删媒体资产。
