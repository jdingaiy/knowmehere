/**
 * stickers-data.js
 * ix/iy = initial position as fraction of canvas width/height
 * rot   = initial rotation degrees
 * surface = 'wall' | 'floor'  (visual hint only, stickers go on bg image)
 */

const STICKERS_DATA = [
  // ── VIBE ──────────────────────────────────────
  {
    id: 'shenghuoyin',
    category: 'vibe',
    surface: 'wall',           // left wall area
    name: '生活印诗歌机',
    sticker: 'assets/stickers/shenghuoyin.webp',
    tags: ['AIGC', '24H 黑客松', 'Top 15', '小红书'],
    description: '从现实生活中收集文字碎片进行创作的 AI 拼字产品。用手机拍摄招牌、包装、路牌中的字母，OCR 识别后沉淀为个人"生活字母库"，再由 AI 根据情绪关键词生成短诗。',
    role: '独立设计 · 体验设计实习（小红书）',
    period: '2026.05',
    metrics: [
      { value: '24H', label: '黑客松独立完成' },
      { value: 'Top15', label: '全站作品排名' },
    ],
    demoType: 'iframe',
    demoUrl: 'https://lifescribe-beta.vercel.app/',
    demoAspect: 'phone',
    longImages: [
      'assets/projects/shenghuoyin/long/1.webp',
      'assets/projects/shenghuoyin/long/2.webp',
      'assets/projects/shenghuoyin/long/3.webp',
      'assets/projects/shenghuoyin/long/4.webp',
      'assets/projects/shenghuoyin/long/5.webp',
      'assets/projects/shenghuoyin/long/6.webp',
    ],
    heroEmoji: '🌿',
    ix: 0.10, iy: 0.10, rot: -7,
    size: 'large',
  },
  {
    id: 'tashi',
    category: 'vibe',
    surface: 'wall',           // right wall area
    name: '它石智航官网',
    sticker: 'assets/stickers/tashi.webp',
    tags: ['Vibe Coding', '品牌官网', '前端开发'],
    description: '为建筑品牌「它石智航」vibe coding 的官网首页 demo，探索沉浸式空间叙事与品牌视觉的结合。全程使用 Cursor 辅助完成从设计到前端实现的完整链路。',
    role: '独立设计 & 开发',
    period: '2025',
    metrics: [
      { value: '全栈', label: 'Vibe Coding 实现' },
    ],
    demoType: 'iframe',
    demoUrl: 'https://tarsweb.pages.dev/',
    heroEmoji: '🏢',
    ix: 0.68, iy: 0.08, rot: 9,
    size: 'normal',
  },

  // ── PORTFOLIO ──────────────────────────────────
  {
    id: 'ikea-aigc',
    category: 'portfolio',
    surface: 'wall',
    name: '宜家 AIGC 生产引擎',
    sticker: 'assets/stickers/ikea-aigc.webp',
    tags: ['AIGC', 'B2B', '效率工具', '宜家'],
    description: '针对海量长尾商品视频缺失、外包成本高昂问题，设计以线性叙事流与人机协同为核心的 AI 视频生产工具。结构化 Prompt 和预设封装植入视觉护栏，实现端到端规模化商业级生产。',
    role: 'UX 实习生 · 宜家中国创新中心 · 独立主导',
    period: '2025.07 – 2025.12',
    metrics: [
      { value: '↑80%', label: '视频产出效率' },
      { value: '20万', label: '年节省外包成本' },
      { value: '↑50%', label: '视频覆盖率' },
    ],
    demoType: null, demoUrl: null,
    heroEmoji: '🤖',
    ix: 0.36, iy: 0.07, rot: 3,
    size: 'normal',
    longImages: [
      'assets/projects/ikea-aigc/long/1.webp',
      'assets/projects/ikea-aigc/long/2.webp',
      'assets/projects/ikea-aigc/long/3.webp',
      'assets/projects/ikea-aigc/long/4.webp',
      'assets/projects/ikea-aigc/long/5.webp',
      'assets/projects/ikea-aigc/long/6.webp',
      'assets/projects/ikea-aigc/long/7.webp',
      'assets/projects/ikea-aigc/long/8.webp',
      'assets/projects/ikea-aigc/long/9.webp',
      'assets/projects/ikea-aigc/long/10.webp',
      'assets/projects/ikea-aigc/long/11.webp',
      'assets/projects/ikea-aigc/long/12.webp',
    ],
  },
  {
    id: 'ikea-guide',
    category: 'portfolio',
    surface: 'floor',          // floor area
    name: '宜家虚拟导购助手',
    sticker: 'assets/stickers/ikea-guide.webp',
    tags: ['对话 UI', 'RAG', '情感化设计', '宜家'],
    description: '聚焦门店高 SKU 区域无员工值守导致的顾客静默流失痛点，设计基于 RAG 的虚拟导购，提供参数对比、货架导航等拟人化选品支持，引入情感化微交互激励数据回流。',
    role: 'UX 实习生 · 宜家中国创新中心 · 独立主导',
    period: '2025.07 – 2025.12',
    metrics: [
      { value: '89%', label: '结构化问答准确率' },
      { value: '↑15%', label: '顾客停留时长' },
      { value: '↑12%', label: '锅具品类销量' },
    ],
    demoType: null, demoUrl: null,
    heroEmoji: '🛒',
    ix: 0.54, iy: 0.62, rot: -12,
    size: 'tiny',
    longImages: [
      'assets/projects/ikea-guide/long/1.webp',
      'assets/projects/ikea-guide/long/2.webp',
      'assets/projects/ikea-guide/long/3.webp',
      'assets/projects/ikea-guide/long/4.webp',
      'assets/projects/ikea-guide/long/5.webp',
      'assets/projects/ikea-guide/long/6.webp',
      'assets/projects/ikea-guide/long/7.webp',
    ],
  },
  // 部分项目已拆到 js/stickers-private.js，由 middleware 按密码放行/拦截。

  // ── STUDIO ─────────────────────────────────────
  {
    id: 'hci-studio',
    category: 'studio',
    surface: 'floor',
    name: '折叠装置 · HCI 研究',
    sticker: 'assets/stickers/hci-studio.webp',
    tags: ['HCI', 'YOLOv8', '机器学习', '论文一作'],
    description: '结合 YOLOv8 视觉算法与机器学习，研究实时响应人群密度并进行形态演变的具身智能折叠装置。第一作者论文收录于 2025 计算性设计学术论坛。',
    role: '研究者 · 第一作者 · 天津大学数字化设计工作室',
    period: '2024.09 – 2025',
    metrics: [
      { value: '论文', label: '第一作者 · 2025 计算性设计论坛' },
    ],
    demoType: null, demoUrl: null,
    heroEmoji: '🏗️',
    ix: 0.76, iy: 0.58, rot: -8,
    size: 'normal',
    longImages: [
      'assets/projects/hci-studio/long/01.webp',
      'assets/projects/hci-studio/long/02.webp',
      'assets/projects/hci-studio/long/03.webp',
      'assets/projects/hci-studio/long/04.webp',
      'assets/projects/hci-studio/long/05.webp',
      'assets/projects/hci-studio/long/06.webp',
      'assets/projects/hci-studio/long/07.webp',
      'assets/projects/hci-studio/long/08.webp',
      'assets/projects/hci-studio/long/09.webp',
      'assets/projects/hci-studio/long/10.webp',
      'assets/projects/hci-studio/long/11.webp',
    ],
  },

  // ── ILLUSTRATION ───────────────────────────────
];

if (typeof window !== 'undefined') window.STICKERS_DATA = STICKERS_DATA;
