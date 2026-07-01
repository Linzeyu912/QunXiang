/**
 * Chinese name handling utilities
 */

// Common Chinese surnames (~500 most common)
export const CHINESE_SURNAMES = new Set([
  // Top 100 surnames
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
  '徐', '孙', '马', '朱', '胡', '郭', '林', '何', '高', '梁',
  '罗', '郑', '宋', '谢', '唐', '韩', '曹', '许', '邓', '萧',
  '冯', '曾', '程', '蔡', '彭', '潘', '袁', '於', '董', '余',
  '苏', '叶', '杜', '魏', '沈', '夏', '马', '姜', '范', '方',
  '石', '姚', '谭', '廖', '邹', '熊', '金', '陆', '郝', '孔',
  '白', '崔', '康', '毛', '邱', '秦', '江', '史', '顾', '侯',
  '邵', '孟', '龙', '万', '段', '雷', '钱', '汤', '尹', '黎',
  '易', '常', '武', '乔', '贺', '赖', '龚', '文', '庞', '樊',
  '兰', '殷', '施', '陶', '洪', '翟', '安', '颜', '倪', '严',

  // Additional common surnames
  '温', '赖', '丁', '聂', '齐', '向', '申', '景', '柴', '连',
  '朴', '习', '宫', '鲁', '葛', '窦', '梅', '盛', '林', '览',
  '游', '区', '刃', '封', '楚', '党', '翟', '那', '简', '饶',
  '空', '甘', '忻', '柴', '薄', '校', '冒', '栋', '茆', '衡',
  '党', '巨', '师', '栗', '勾', '利', '孟', '牛', '寿', '通',
  '边', '扈', '燕', '冀', '浦', '贵', '阿', '东', '门', '南',
  '官', '辛', '蔺', '呼', '干', '区', '练', '余', '帅', '豆',
  '虎', '鹿', '伏', '印', '怀', '邴', '薄', '校', '仉', '盖',
  '迟', '於', '邬', '母', '咎', '盖', '后', '储', '乔', '郁',
  '邬', '代', '荣', '共', '仇', '堵', '冉', '宰', '韶', '戚',

  // Compound surnames
  '欧阳', '司马', '上官', '诸葛', '慕容', '令狐', '公孙', '西门',
  '南宫', '东方', '万俟', '哈哈', '单于', '长孙', '宇文', '呼延',
  '赫连', '澹台', '皇甫', '尉迟', '公羊', '漆雕', '乐正', '壤驷',
  '公良', '拓跋', '夹谷', '宰父', '谷梁', '晋楚', '闫', '富察',
  '叶', '那', '哈', '莎克', '唐努', '乌尔', '济', '车', '敏',
]);

// Chinese name prefixes and suffixes
export const NAME_PREFIXES = [
  '老', '小', '阿', '大', '二', '三', '四', '五', '六', '七', '八', '九',
  '太', '少', '伟', '大', '小',
];

export const NAME_SUFFIXES = [
  '公', '婆', '爷', '奶', '叔', '姨', '哥', '姐', '弟', '妹',
  '生', '儿', '郎', '娘', '姑', '娘',
];

/**
 * Check if a character is a likely Chinese surname
 */
export function isChineseSurname(word: string): boolean {
  if (word.length !== 1) return false;
  return CHINESE_SURNAMES.has(word);
}

/**
 * Check if a name is likely a Chinese given name
 */
export function isLikelyGivenName(word: string): boolean {
  // Given names are typically 1-2 characters
  if (word.length < 1 || word.length > 3) return false;

  // Should not be a surname
  if (isChineseSurname(word)) return false;

  // Should contain Chinese characters
  if (!/[一-龥]/.test(word)) return false;

  return true;
}

/**
 * Extract potential Chinese names from text
 */
export function extractChineseNames(
  text: string
): { name: string; index: number; confidence: number }[] {
  const results: { name: string; index: number; confidence: number }[] = [];

  // Pattern: surname + 1-2 character given name
  const pattern = /([一-龥])([一-龥]{1,2})/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const surname = match[1];
    const givenName = match[2];
    const fullName = surname + givenName;

    if (isChineseSurname(surname)) {
      // Check if preceded by a prefix (老张小, 阿王, etc.)
      let prefix = '';
      if (match.index > 0) {
        const prevChar = text[match.index - 1];
        if (NAME_PREFIXES.includes(prevChar)) {
          prefix = prevChar;
        }
      }

      // Calculate confidence
      let confidence = 0.7;
      if (givenName.length === 2) confidence += 0.2;
      if (prefix) confidence += 0.1;

      results.push({
        name: prefix + fullName,
        index: match.index,
        confidence,
      });
    }
  }

  return results;
}

/**
 * Normalize Chinese name variations
 */
export function normalizeChineseName(name: string): string {
  let normalized = name.trim();

  // Remove common prefixes
  for (const prefix of NAME_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.substring(1);
      break;
    }
  }

  // Remove common suffixes that aren't part of the name
  for (const suffix of NAME_SUFFIXES) {
    if (normalized.endsWith(suffix) && normalized.length > 2) {
      normalized = normalized.substring(0, normalized.length - 1);
    }
  }

  return normalized;
}

/**
 * Check if two Chinese names might refer to the same person
 */
export function isSameChineseName(name1: string, name2: string): boolean {
  const n1 = normalizeChineseName(name1);
  const n2 = normalizeChineseName(name2);

  // Exact match after normalization
  if (n1 === n2) return true;

  // One contains the other (with prefix/suffix variation)
  if (n1.includes(n2) || n2.includes(n1)) return true;

  return false;
}
