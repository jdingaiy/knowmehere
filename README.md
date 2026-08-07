# 谭加奇 · 个人作品集

UX 设计师 / AI 产品方向，天津大学 2027 届。

3D 互动作品集，主页是一根可旋转的电线杆，贴纸代表项目；点击查看详情、左滑切换到简历页。

## 本地运行

需要 http 服务（WebGL 加载贴图不支持 file://）：

```bash
npm run serve        # 用仓库自带 _srv.cjs（在 .gitignore 里，没有就自己写一份）
# 或
npx http-server -p 8123
python -m http.server 8123
```

打开 http://localhost:8123/

## 维护脚本

```bash
npm run optimize     # 上传新图后跑：assets/projects、assets/stickers 下 PNG/JPG 原地转 WebP 并压缩
npm run manifest     # IP 贴纸有增删后跑：重新生成 assets/ip-manifest*.json
```

素材上传规范见 [ASSETS.md](ASSETS.md)。

## 技术

- 原生 HTML / CSS / 模块化 JS，零构建
- Three.js (r160) 本地打包（js/three.module.js）
- 贴纸是 WebGL 上的细分曲面网格，沿圆柱体表面弯折
