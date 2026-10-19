# 程特立个人作品集

## 免费托管方式

- Gitee 仓库保存网页源码：<https://gitee.com/chengteli/personal-portfolio>
- GitHub Pages 发布公开网页：<https://chengteli.github.io/>
- 七牛云 Kodo 仅用于原始作品文件备份，不参与网页访问。

网页和作品媒体都从 GitHub Pages 仓库读取，不需要购买域名，也不依赖七牛的 CDN 测试域名。当前公开站点已有 `assets/` 图片和视频；`portfolio-data/site-data.json` 是作品清单。

## 添加或删除作品

1. 把图片或视频放进 `assets/` 目录，并使用英文或数字文件名。
2. 在 `portfolio-data/site-data.json` 的 `items` 数组添加或删除条目。`media_type` 填 `image` 或 `video`，`media_url` 使用相对路径，例如 `assets/my-work.webp`。
3. 将更新后的网页文件同步到 Gitee 源码仓库和 GitHub Pages 仓库。GitHub Pages 更新后会自动发布。
4. 可在七牛云控制台另存一份原始媒体文件作备份；备份不影响网页展示。

示例：

```json
{
  "title": "作品名称",
  "description": "作品说明",
  "media_type": "image",
  "media_url": "assets/example.webp"
}
```

## 预览

直接打开 `index.html` 可以看到内置示例。页面在线运行时，会读取同仓库中的 `portfolio-data/site-data.json`。
