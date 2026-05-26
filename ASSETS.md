# 素材上传规范

每个项目的详情页有三块内容，对应不同的文件夹：

| 板块 | 在详情页的位置 | 文件夹 |
|---|---|---|
| **图集** Gallery | 顶部，大图左右切换 | `assets/projects/<项目id>/gallery/` |
| **Demo** | 中部，iframe 嵌入 | （不存图，在 `js/stickers-data.js` 里填 `demoUrl`） |
| **长图** Long | 底部，作品集排版页无缝拼接 | `assets/projects/<项目id>/long/` |

任何一块没素材就留空，详情页那块自动不显示。

---

## 项目 ID 一览

文件夹名必须用下面这些英文 id，不要用中文名：

| ID（文件夹名） | 项目名（中文） |
|---|---|
| `shenghuoyin` | 生活印诗歌机 |
| `tashi` | 它石智航官网 |
| `ikea-aigc` | 宜家 AIGC 生产引擎 |
| `ikea-guide` | 宜家虚拟导购助手 |
| `nova-chat` | 小红书风险感知平台 |
| `hci-studio` | 折叠装置 · HCI 研究 |
| `illustration` | 日常插画 |

---

## 文件命名规则

文件名以两位数字开头，按显示顺序编号：

```
assets/projects/shenghuoyin/gallery/
  01.jpg
  02.jpg
  03.jpg
  04.jpg
```

数字后面可以加任何描述（用 `-` 分隔），比如 `01-cover.jpg`、`02-flow.jpg`，**只要数字开头能正确排序就行**。

不要用：中文、空格、特殊符号。

---

## 图片规格

### Gallery（顶部图集）
- **宽度**：1600–2400px（详情页最大显示宽度 1100，预留 2 倍清晰度）
- **格式**：`.jpg`（照片/截图） / `.png`（带透明的）
- **数量**：3–6 张通常够看
- **内容**：项目封面、关键截图、流程图、最终效果等

### Long（底部长图）
- **宽度**：**统一 1600px**（这点很关键，因为渲染时按 100% 宽度拼接，宽度不一致会有错位）
- **高度**：任意（每张就是你作品集的一页）
- **格式**：`.jpg` 推荐（高度大的图 PNG 会很大）
- **数量**：随项目内容多少，10–30 张都正常
- **内容**：你作品集排好版的整页导出，按页序号命名

### 单文件体积
- 单张图建议 **<500KB**
- 单个项目所有图加起来建议 **<5MB**（手机加载体验）
- 超过 **100MB** 的单文件 GitHub 会拒收

---

## 怎么上传（两种方式任选）

### 方式 A：在 GitHub 网页拖拽上传（最简单，任何设备都行）

1. 打开 https://github.com/jdingaiy/knowmehere
2. 点进 `assets/projects/<项目id>/gallery/` 或 `long/` 文件夹
3. 右上角 **Add file → Upload files**
4. 把图片拖进上传区
5. 下方填一句提交说明，比如 `add: shenghuoyin gallery 4 张`
6. 点 **Commit changes**

✅ 适合：手机/平板/任何没装 git 的设备
❌ 限制：单次 ≤ 100 个文件、单文件 ≤ 25MB（网页上传）

### 方式 B：另一台电脑用 git（适合大批量）

1. **首次**：把仓库 clone 下来
   ```bash
   git clone https://github.com/jdingaiy/knowmehere.git
   cd knowmehere
   ```

2. **后续每次**：先拉最新，再加文件，再 push
   ```bash
   git pull                                       # 拉最新
   # 把图片放到对应文件夹...
   git add assets/projects/                       # 暂存
   git commit -m "add: <项目名> gallery 图片"     # 说明加了啥
   git push                                       # 推到 GitHub
   ```

3. **认证**：首次 push 时 git 会弹浏览器登录 GitHub（用 Git Credential Manager）。登过一次后系统记住凭据，之后不用再登。

✅ 适合：批量传、跟代码一起改
❌ 限制：得装 git

---

## 上传后会自动显示吗？

**不会**。图片是素材，代码还需要知道"用哪些图"。我会写一个小脚本扫文件夹自动填进 `js/stickers-data.js`，或者你告诉我"shenghuoyin 准备好了，gallery 有 4 张、long 有 12 张"，我手动填。

你也可以自己改 `js/stickers-data.js`，每个项目对象里加两个字段：

```js
{
  id: 'shenghuoyin',
  // ...其他字段
  gallery: [
    'assets/projects/shenghuoyin/gallery/01.jpg',
    'assets/projects/shenghuoyin/gallery/02.jpg',
    'assets/projects/shenghuoyin/gallery/03.jpg',
  ],
  longImages: [
    'assets/projects/shenghuoyin/long/01.jpg',
    'assets/projects/shenghuoyin/long/02.jpg',
    // ...
  ],
}
```

保存、push、刷新页面就能看到。

---

## 常见问题

**Q：传错文件夹了怎么办？**
A：在 GitHub 网页打开那个文件，右上角 ⋯ → Delete，然后重新传到正确位置。

**Q：图传上去但页面不显示？**
A：检查 `stickers-data.js` 里有没有写对路径，路径区分大小写。

**Q：手机能直接拖图到 GitHub 吗？**
A：能。GitHub 网页在手机浏览器也支持上传，只是要点 Add file 选择相册里的图。

**Q：传完后想替换某张图？**
A：删掉旧的，传同名新图。或者保留旧的、传新文件名，再到 `stickers-data.js` 更新路径数组。

**Q：仓库一直没有这些 `.gitkeep` 文件？**
A：那是我建的占位文件，让空目录能存在于 git 里。等你传了真图片之后可以删掉它们（也可以留着，不碍事）。
