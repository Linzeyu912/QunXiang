/**
 * Coreference patterns for Chinese and English
 */

// Chinese pronoun patterns
export const CHINESE_PRONOUNS = {
  male: ['他', '他的', '他', '他们', '他们的'],
  female: ['她', '她的', '她们', '她们'],
  neutral: ['它', '它的', '它们', '它们的'],
  firstPerson: ['我', '我的', '我们', '我们'],
  secondPerson: ['你', '你的', '你们', '你们的'],
};

export const ENGLISH_PRONOUNS = {
  male: ['he', 'his', 'him', 'they', 'their', 'them'],
  female: ['she', 'her', 'hers', 'they', 'their', 'them'],
  neutral: ['it', 'its', 'they', 'their', 'them'],
  firstPerson: ['i', 'my', 'me', 'we', 'our', 'us'],
  secondPerson: ['you', 'your', 'yours'],
};

// Chinese honorifics and titles
export const CHINESE_HONORIFICS = [
  '先生', '女士', '小姐', '太太', '夫人',
  '老爷', '少爷', '小姐', '姑娘',
  '大人', '老爷', '夫人', '公子', '公主',
  '王', '皇', '帝', '后', '妃', '臣',
  '将军', '元帅', '大人', '老爷', '夫人',
  '老爷', '奶奶', '相公', '娘子', '夫君', '妻子',
  '道长', '大师', '仙人', '神', '佛',
];

// English honorifics
export const ENGLISH_HONORIFICS = [
  'mr', 'mrs', 'miss', 'ms', 'sir', 'madam', 'lady', 'lord',
  'princess', 'prince', 'king', 'queen', 'duke', 'duchess',
  'doctor', 'professor', 'captain', 'major', 'colonel', 'general',
];

// Descriptor patterns (patterns that describe someone without naming)
export const DESCRIPTOR_PATTERNS = [
  // Chinese patterns
  /那个(.?)人/,
  /这位(.?)人/,
  /此人/,
  /此人/,
  /老者/,
  /年轻人/,
  /少年/,
  /少女/,
  /中年人/,
  /老(.{0,3})/,
  /年轻的(.{0,3})/,
  /小小的(.{0,3})/,
  // English patterns
  /the (old|young|little|oldest|youngest) (man|woman|person|boy|girl|child)/i,
  /the (tall|short|big|little|young|old) (one|man|woman|guy|person)/i,
  /a (certain|some) (man|woman|person|boy|girl)/i,
];

// Alias patterns
export const ALIAS_PATTERNS = [
  // Chinese patterns
  /"([^"]+)"常被称为(.+)/,
  /(.+)，又名"([^"]+)"/,
  /(.+)，人称"([^"]+)"/,
  /(.+)，绰号"([^"]+)"/,
  /称(.+)为(.+)/,
  /(.+)之(.+)/,
  // English patterns
  /(\w+),?\s+known\s+as\s+"(\w+)"/i,
  /(\w+)\s+nicknamed\s+"(\w+)"/i,
  /(\w+)\s+also\s+calls?\s+(?:himself|herself|themselves)\s+"(\w+)"/i,
  /(\w+)\s+(?:or|aka|also\s+known\s+as)\s+"(\w+)"/i,
  /(\w+)\s+for\s+(?:short|shortened)/i,
];

// Family relationship words
export const FAMILY_WORDS = {
  chinese: [
    '父亲', '母亲', '爸爸', '妈妈', '爹', '娘',
    '儿子', '女儿', '孩子', '子女',
    '兄弟', '兄妹', '姐妹', '弟弟', '哥哥', '姐姐', '妹妹',
    '丈夫', '妻子', '老公', '老婆', '相公', '娘子',
    '岳父', '岳母', '公公', '婆婆',
    '爷爷', '奶奶', '外公', '外婆', '姥姥', '祖父', '祖母',
    '叔叔', '伯伯', '舅舅', '姨', '姑姑', '姑妈', '姑父',
    '侄子', '侄女', '外甥', '外甥女',
    '儿子', '女儿', '孩子', '儿女',
  ],
  english: [
    'father', 'mother', 'dad', 'mom', 'parent',
    'son', 'daughter', 'child', 'children',
    'brother', 'sister', 'siblings', 'brother', 'sister',
    'husband', 'wife', 'spouse', 'married',
    'uncle', 'aunt', 'cousin',
    'grandfather', 'grandmother', 'grandparent',
    'nephew', 'niece',
    'son', 'daughter', 'children',
  ],
};

// Romantic relationship words
export const ROMANTIC_WORDS = {
  chinese: [
    '爱人', '恋人', '情人', '心爱的人', '心上人',
    '亲爱的', '宝贝', '甜心', '心肝',
    '追求', '爱慕', '暗恋', '喜欢',
  ],
  english: [
    'lover', 'beloved', 'sweetheart', 'darling', 'dear',
    'love', 'loves', 'loved', 'romantic',
    'kiss', 'kissed', 'embrace', 'hug', 'hugged',
    'passion', 'passionate',
  ],
};

// Friendship words
export const FRIENDSHIP_WORDS = {
  chinese: [
    '朋友', '好友', '伙伴', '同伴', '兄弟', '闺蜜',
    '故人', '旧友', '知音', '之交',
    '哥们', '兄弟伙', '铁哥们',
  ],
  english: [
    'friend', 'friends', 'companion', 'buddy', 'pal',
    'best friend', 'close friend', 'old friend',
    'comrade', 'ally', 'partner',
  ],
};

// Antagonistic words
export const ANTAGONISTIC_WORDS = {
  chinese: [
    '敌人', '仇人', '仇家', '对手', '敌将',
    '叛徒', '奸细', '内奸',
    '恶人', '坏人', '歹人',
    '杀', '攻击', '背叛', '欺骗',
  ],
  english: [
    'enemy', 'foe', 'adversary', 'rival',
    'traitor', 'betrayer', 'backstabber',
    'villain', 'evil', 'wicked',
    'kill', 'attack', 'betray', 'deceive', 'trick',
  ],
};
