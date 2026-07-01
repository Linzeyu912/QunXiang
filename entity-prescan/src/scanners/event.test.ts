import { describe, expect, it } from 'vitest';
import { scanEventEntities } from './event.js';
import type { ScanChapter } from '../types.js';

describe('scanEventEntities', () => {
  it('summarizes plot events instead of copying source sentences', () => {
    const chapter: ScanChapter = {
      index: 3,
      content:
        '\u8bb8\u4e03\u5b89\u7834\u83b7\u7a0e\u94f6\u6848\u3002' +
        '\u5929\u6c14\u5f88\u597d\u3002' +
        '\u9b4f\u6e0a\u6d3e\u9063\u8bb8\u4e03\u5b89\u524d\u5f80\u4e91\u5dde\u8c03\u67e5\u6848\u60c5\u3002' +
        '\u671d\u91ce\u9707\u52a8\uff0c\u5723\u4e0a\u52c3\u7136\u5927\u6012\uff0c\u4eb2\u81ea\u4e0b\u4ee4\uff0c\u8bb8\u5e73\u5fd7\u4e8e\u4e94\u65e5\u540e\u65a9\u9996\uff0c\u4e09\u65cf\u4eb2\u5c5e\u8fde\u5750\u3002' +
        '\u9648\u5e9c\u5c39\u9ad8\u5750\u5927\u6905\uff0c\u5ba1\u95ee\u8bb8\u4e03\u5b89\u3002' +
        '\u8bb8\u4e03\u5b89\u60f3\u5230\u8fd9\u91cc\uff0c\u70b9\u4e86\u70b9\u5934\u3002' +
        '\u8bb8\u4e03\u5b89\u79bb\u5f00\u7262\u623f\u3002',
    };

    const events = scanEventEntities(chapter);

    expect(events.map((event) => event.text)).toEqual([
      '\u8bb8\u4e03\u5b89\u7834\u83b7\u7a0e\u94f6\u6848',
      '\u9b4f\u6e0a\u6d3e\u9063\u8bb8\u4e03\u5b89\u524d\u5f80\u4e91\u5dde',
      '\u5723\u4e0a\u4e0b\u4ee4\u65a9\u9996\u8bb8\u5e73\u5fd7',
      '\u9648\u5e9c\u5c39\u5ba1\u95ee\u8bb8\u4e03\u5b89',
    ]);
    expect(events.map((event) => event.text).join('\n')).not.toContain('\uff0c');
    expect(events.every((event) => event.chapterIndex === 3)).toBe(true);
  });

  it('summarizes fantasy conflict events without book-specific subject lists', () => {
    const chapter: ScanChapter = {
      index: 5,
      content:
        '\u845b\u53f6\u8f7b\u58f0\u8bf4\u660e\u6765\u610f\uff0c\u8bf7\u8427\u65cf\u957f\u80fd\u591f\u89e3\u9664\u5a5a\u7ea6\u3002' +
        '\u845b\u53f6\u62ff\u51fa\u805a\u6c14\u6563\u4f5c\u4e3a\u8d54\u793c\uff0c\u5927\u5385\u4e2d\u4f17\u4eba\u9707\u52a8\u3002' +
        '\u8427\u708e\u5199\u4e0b\u4f11\u4e66\uff0c\u5c06\u5c0a\u4e25\u4eb2\u624b\u593a\u56de\u3002' +
        '\u8427\u708e\u4e0e\u7eb3\u5170\u5ae3\u7136\u7acb\u4e0b\u4e09\u5e74\u4e4b\u7ea6\u3002',
    };

    const events = scanEventEntities(chapter);

    expect(events.map((event) => event.text)).toEqual([
      '\u845b\u53f6\u8bf7\u6c42\u89e3\u9664\u5a5a\u7ea6',
      '\u845b\u53f6\u62ff\u51fa\u805a\u6c14\u6563',
      '\u8427\u708e\u5199\u4e0b\u4f11\u4e66',
      '\u8427\u708e\u7acb\u4e0b\u4e09\u5e74\u4e4b\u7ea6',
    ]);
    expect(events.every((event) => event.source === 'regex')).toBe(true);
  });

  it('keeps setup beats before the open退婚 confrontation', () => {
    const chapter: ScanChapter = {
      index: 5,
      title: '\u805a\u6c14\u6563',
      content:
        '\u845b\u53f6\u7ad9\u8d77\u8eab\u6765\u5bf9\u7740\u8427\u6218\u62f1\u4e86\u62f1\u624b\uff0c\u5fae\u7b11\u9053\uff1a\u201c\u8427\u65cf\u957f\uff0c\u6b64\u6b21\u524d\u6765\u8d35\u5bb6\u65cf\uff0c\u4e3b\u8981\u662f\u6709\u4e8b\u76f8\u6c42\uff01\u201d' +
        '\u845b\u53f6\u5728\u63d0\u5230\u5b97\u4e3b\u4e8c\u5b57\u65f6\uff0c\u8138\u5e9e\u4e0a\u7684\u8868\u60c5\uff0c\u7565\u5fae\u90d1\u91cd\u3002' +
        '\u845b\u53f6\u624b\u638c\u4e00\u7ffb\uff0c\u4e00\u53ea\u901a\u4f53\u6cdb\u7eff\u7684\u53e4\u7389\u76d2\u5b50\u5728\u624b\u4e2d\u51ed\u7a7a\u51fa\u73b0\u3002' +
        '\u4e09\u4f4d\u957f\u8001\u597d\u5947\u7684\u4f38\u8fc7\u5934\uff0c\u671b\u7740\u7389\u5323\u5b50\u5185\uff0c\u8eab\u4f53\u731b\u7684\u4e00\u9707\uff0c\u60ca\u58f0\u9053\uff1a\u201c\u805a\u6c14\u6563\uff1f\u201d',
    };

    const events = scanEventEntities(chapter);

    expect(events.map((event) => event.text)).toEqual([
      '\u845b\u53f6\u63d0\u51fa\u9000\u5a5a\u8bf7\u6c42',
      '\u845b\u53f6\u62ff\u51fa\u805a\u6c14\u6563',
    ]);
  });
});
