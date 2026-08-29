import { describe, expect, it } from 'vitest';
import { inferItemCategory } from './item-category.js';

describe('inferItemCategory', () => {
  it('名称关键词命中：武器/功法/丹药/食物/法宝', () => {
    expect(inferItemCategory('紧背花装弩')).toBe('weapon');
    expect(inferItemCategory('玄重尺')).toBe('weapon');
    expect(inferItemCategory('八极崩', '萧炎修炼的斗技')).toBe('skill');
    expect(inferItemCategory('无名口诀')).toBe('skill');
    expect(inferItemCategory('聚气散')).toBe('pill');
    expect(inferItemCategory('恢复大香肠')).toBe('food');
    expect(inferItemCategory('如意百宝囊')).toBe('treasure');
    expect(inferItemCategory('武魂殿魂师徽章')).toBe('treasure');
    expect(inferItemCategory('呼延力头部魂骨')).toBe('treasure');
  });

  it('现代题材：电子设备与文件信物优先于单字误伤', () => {
    // 曾经的误判："苹果笔记本"被"果"判成食物、"面试邀请信"落 other
    expect(inferItemCategory('苹果笔记本')).toBe('electronics');
    expect(inferItemCategory('N96手机')).toBe('electronics');
    expect(inferItemCategory('老式IBM笔记本')).toBe('electronics');
    expect(inferItemCategory('面试邀请信')).toBe('document');
    expect(inferItemCategory('乔薇尼的信')).toBe('document');
    expect(inferItemCategory('父母的照片')).toBe('document');
  });

  it('名称判不出时按描述归类', () => {
    expect(inferItemCategory('诺玛', '一种可以服用的丹药，服用后恢复魂力')).toBe('pill');
    expect(inferItemCategory('奇怪的大蒜', '烤熟后是美味的食物，可以充饥')).toBe('food');
    expect(inferItemCategory('残片', '上古法宝的碎片，信物')).toBe('treasure');
  });

  it('名称命中优先于描述', () => {
    // 名称含"剑"是武器，即使描述听起来像法宝
    expect(inferItemCategory('青莲剑', '剑身刻有莲花纹路的法宝')).toBe('weapon');
  });

  it('两个通道都判不出时返回 other', () => {
    expect(inferItemCategory('神秘的它')).toBe('other');
    expect(inferItemCategory('面试通知书', '卡塞尔学院寄来的普通信函')).toBe('document');
    expect(inferItemCategory('N96手机', '路明非使用的旧手机')).toBe('electronics');
  });

  it('描述为空字符串时等同于无描述', () => {
    expect(inferItemCategory('诺玛', '')).toBe('other');
  });
});
