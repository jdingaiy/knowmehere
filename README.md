# 谭加奇 · 个人作品集

UX 设计师 / AI 产品方向，天津大学 2027 届。

3D 互动作品集，主页是一根可旋转的电线杆，贴纸代表项目；点击查看详情、左滑切换到简历页。

## 本地运行

需要 http 服务（WebGL 加载贴图不支持 file://）。任选其一：

```bash
# 用 Node（仓库自带 _srv.js，但在 .gitignore 里，自己再写一份或用下面这条）
npx http-server -p 8123

# 或用 Python
python -m http.server 8123
```

打开 http://localhost:8123/

## 技术

- 原生 HTML / CSS / 模块化 JS，零构建
- Three.js (r160) via importmap CDN
- 贴纸是 WebGL 上的细分曲面网格，沿圆柱体表面弯折
