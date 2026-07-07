/**
 * stickers-sixteen.js — 小红书保密项目 (NDA)。
 * 单独成文，只对「完整密码」放行；middleware 会对「对外密码」把此文件 404。
 * 因此它必须在 stickers-data.js 之后、board 初始化之前加载。
 */
STICKERS_DATA.push({
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
});
