/**
 * stickers-private.js — 需要「完整密码」才可见的项目（NDA / 保密）。
 * middleware 会对「对外密码」把本文件整个 404，届时 STICKERS_DATA 里就没有这些项目。
 * 必须在 stickers-data.js 之后、board 初始化之前加载。
 *
 * 新增保密项目：在这里 push 一条，并把它的图片路径加进 middleware.js 的 PRIVATE_PATHS。
 */
STICKERS_DATA.push(
  {
    id: 'sixteen',
    category: 'portfolio',
    surface: 'wall',
    name: 'AI 健康打卡',
    sticker: 'assets/stickers/sixteen.png',
    tags: ['C 端', 'AI', '健康', '小红书'],
    description: '针对小红书健康打卡场景，重构日历信息架构，设计 AI 驱动的智能打卡引导流程。通过情感化贴纸激励机制与个性化反馈，显著提升用户打卡渗透率与持续参与度。',
    role: 'UX 实习生 · 小红书 · 独立主导',
    period: '2026.01 – 2026.05',
    metrics: [
      { value: '↑25%', label: '打卡渗透率' },
      { value: '95%+', label: '贴纸视觉可用率' },
    ],
    demoType: null, demoUrl: null,
    longImages: [
      'assets/projects/sixteen/sixteen1.png',
      'assets/projects/sixteen/sixteen2.png',
      'assets/projects/sixteen/sixteen3.png',
      'assets/projects/sixteen/sixteen4.png',
      'assets/projects/sixteen/sixteen5.png',
      'assets/projects/sixteen/sixteen6.png',
    ],
    heroEmoji: '📅',
    ix: 0.44, iy: 0.32, rot: -5,
    size: 'tiny',
  },
  {
    id: 'nova-chat',
    category: 'portfolio',
    surface: 'wall',
    name: '小红书风险感知平台',
    sticker: 'assets/stickers/nova-chat.png',
    tags: ['B2B', 'Agent', '中台产品', '小红书'],
    description: '将搜索巡检、风险研判及处置报告等核心运营能力解构为标准化 Skills，依托 Nova Chat 构建 7×24 风险运营专家 Agent，解决跨平台操作零散和技能沉淀难的痛点。',
    role: 'UX 实习生（小红书）· 独立主导 MVP 设计',
    period: '2026.03',
    metrics: [
      { value: '↓40%', label: '核心操作链路时长' },
      { value: '↓30%', label: '员工上手培训时间' },
    ],
    demoType: null, demoUrl: null,
    longImages: [
      'assets/projects/nova-chat/B%20(1).png',
      'assets/projects/nova-chat/B%20(2).png',
      'assets/projects/nova-chat/B%20(3).png',
      'assets/projects/nova-chat/B%20(4).png',
      'assets/projects/nova-chat/B%20(5).png',
      'assets/projects/nova-chat/B%20(6).png',
      'assets/projects/nova-chat/B%20(7).png',
      'assets/projects/nova-chat/B%20(8).png',
    ],
    heroEmoji: '🛡️',
    ix: 0.14, iy: 0.48, rot: 6,
    size: 'small',
  },
);
