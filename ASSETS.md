# 素材上传规范

每个项目的素材放在固定文件夹，详情页有两块内容：

| 板块 | 在详情页的位置 | 文件夹 |
|---|---|---|
| **Demo** | 中部，iframe 嵌入 | （不存图，在 `js/stickers-data.js` 里填 `demoUrl`） |
| **长图** Long | 底部，作品集排版页无缝拼接 | `assets/projects/<项目id>/long/` |

贴纸本体（电线杆上显示的那张图）放 `assets/stickers/<项目id>.png` 或 `.webp`。
IP 插画贴纸放 `assets/stickers/ip-stickers/<ip名>/`，长图放 `assets/projects/ip/<ip名>/`。

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
| `sixteen` | AI 健康打卡 |
| `nova-chat` | 小红书风险感知平台 |
| `hci-studio` | 折叠装置 · HCI 研究 |

`sixteen` 和 `nova-chat` 的数据在 `js/stickers-private.js`（原 NDA 拆分，全站公开后与公开项目等价）。

---

## 文件命名规则

文件名以数字开头，按显示顺序编号：

```
assets/projects/shenghuoyin/long/
  1.png
  2.png
  3.png
```

不要用：中文、空格、特殊符号。

---

## 上传后的两步（重要）

图片传进仓库后，在本地跑：

```bash
npm run optimize   # PNG/JPG 原地转成 .webp 并压缩（长图限宽 1600，贴纸限宽 1024）
npm run manifest   # 仅 IP 贴纸有增删时需要：重新生成 ip-manifest.json
```

然后把 `js/stickers-data.js`（或保密项目 `js/stickers-private.js`）里对应项目的
`longImages` 数组改成新的 `.webp` 路径，保存即可。普通项目暂时手动维护这个数组。

IP 插画不用手改：`npm run manifest` 扫文件夹自动生成清单。

---

## 图片规格

### 贴纸（电线杆上）
- **内容**：项目封面图，透明底 PNG 会按轮廓裁出异形白边；不透明图会自动加圆角白边卡片
- **尺寸**：随便传，`npm run optimize` 会压到 1024 宽以内

### Long（底部长图）
- **宽度**：**统一 1600px**（渲染时按 100% 宽度拼接，宽度不一致会有错位）
- **高度**：任意（每张就是作品集的一页）
- **数量**：随项目内容多少，10–30 张都正常

### 单文件体积
- 不用手动压图，`npm run optimize` 会处理（转 WebP 后单张通常 <300KB）
- 超过 **100MB** 的单文件 GitHub 会拒收

---

## 怎么上传（两种方式任选）

### 方式 A：在 GitHub 网页拖拽上传（最简单，任何设备都行）

1. 打开 https://github.com/jdingaiy/knowmehere
2. 点进 `assets/projects/<项目id>/long/` 文件夹
3. 右上角 **Add file → Upload files**
4. 把图片拖进上传区
5. 下方填一句提交说明，比如 `add: shenghuoyin long 4 张`
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
   git add assets/                                # 暂存
   git commit -m "add: <项目名> 图片"             # 说明加了啥
   git push                                       # 推到 GitHub
   ```

3. **认证**：首次 push 时 git 会弹浏览器登录 GitHub（用 Git Credential Manager）。登过一次后系统记住凭据，之后不用再登。

✅ 适合：批量传、跟代码一起改
❌ 限制：得装 git 和 Node（跑 optimize 用）

---

## 常见问题

**Q：传错文件夹了怎么办？**
A：在 GitHub 网页打开那个文件，右上角 ⋯ → Delete，然后重新传到正确位置。

**Q：图传上去但页面不显示？**
A：检查 `stickers-data.js` 里有没有写对路径；注意 `npm run optimize` 之后扩展名是 `.webp`，路径区分大小写。

**Q：想替换某张图？**
A：删掉旧的，传同名新图，本地跑一遍 `npm run optimize` 即可。

**Q：仓库里的 `.gitkeep` 是什么？**
A：占位文件，让空目录能存在于 git 里。传了真图片之后可以删掉（也可以留着，不碍事）。
