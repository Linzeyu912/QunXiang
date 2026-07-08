import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { decodeText, detectEncoding } from './encoding.js';

/**
 * GBK/GB18030 编码乱码修复（S4）的回归测试。
 *
 * 修改前两个致命缺陷：
 * 1. detectEncoding 用 Buffer.toString('utf-8') 是否抛异常来判断编码，
 *    但该方法对任意字节都不抛（只替换成 U+FFFD）→ 永远判 utf-8，GBK 检测是死代码。
 * 2. decodeText 的 GBK 分支调 Buffer.toString('gb18030')，但 Node 原生
 *    Buffer.toString 根本不支持 gb18030/gbk（抛 Unknown encoding）→
 *    catch 后回到 utf-8，GBK 文件仍乱码。
 *
 * 修改后：detectEncoding 用严格 UTF-8 字节序列校验；decodeText 用 iconv-lite。
 */
describe('encoding（GBK/GB18030 支持）', () => {
  it('正确解码 GBK 编码的中文', () => {
    // 用 iconv 构造 GBK 的 "你好，世界" 字节
    const gbkBytes = iconv.encode('你好，世界', 'gbk');
    expect(decodeText(gbkBytes)).toBe('你好，世界');
  });

  it('正确解码 GB18030 编码的中文', () => {
    const gb18030Bytes = iconv.encode('小说实体提取', 'gb18030');
    expect(decodeText(gb18030Bytes)).toBe('小说实体提取');
  });

  it('合法 UTF-8 不被误判为 GBK', () => {
    const utf8Text = '这是一段 UTF-8 编码的中文文本，包含 ASCII 与汉字 mixed content。';
    const utf8Bytes = Buffer.from(utf8Text, 'utf-8');
    expect(decodeText(utf8Bytes)).toBe(utf8Text);
    expect(detectEncoding(utf8Bytes)).toBe('utf-8');
  });

  it('detectEncoding 对 GBK 字节返回 gb18030', () => {
    const gbkBytes = iconv.encode('斗破苍穹', 'gbk');
    expect(detectEncoding(gbkBytes)).toBe('gb18030');
  });

  it('剥离 UTF-8 BOM', () => {
    const text = '带 BOM 的文本';
    // 手动构造带 UTF-8 BOM 的 buffer
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf-8')]);
    expect(decodeText(withBom)).toBe(text);
  });

  it('纯 ASCII 文本正常解码', () => {
    const ascii = 'Journey to the West - Chapter 1';
    expect(decodeText(Buffer.from(ascii, 'utf-8'))).toBe(ascii);
    expect(detectEncoding(Buffer.from(ascii, 'utf-8'))).toBe('utf-8');
  });

  it('空 buffer 返回空字符串', () => {
    expect(decodeText(Buffer.alloc(0))).toBe('');
  });

  it('GBK 章节标题常见格式正确解码（回归：实际小说文本）', () => {
    // 模拟真实小说开头：第一章标题
    const novelStart = '第一章 初入江湖\n\n少年萧炎缓缓睁开双眼……';
    const gbkBytes = iconv.encode(novelStart, 'gbk');
    const decoded = decodeText(gbkBytes);
    expect(decoded).toBe(novelStart);
    // 关键：不应出现替换字符 U+FFFD（乱码标志）
    expect(decoded).not.toContain('\uFFFD');
  });
});
