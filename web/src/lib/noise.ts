import type { NoiseCategory } from '@/types';

/** 噪声行分类的中文标签（从 ChaptersPage 迁出，供章节页与阅读器共用）。 */
export const NOISE_LABEL: Record<NoiseCategory, string> = {
  url: '链接',
  promo: '推广',
  template: '模板',
  decoration: '装饰',
  repeated: '重复',
  garbled: '乱码',
  meta: '元信息',
  dialogue: '对白标记',
  onomatopoeia: '拟声词',
  short: '短句',
};
