/**
 * Relationship indicator patterns
 */

export const RELATIONSHIP_INDICATORS = {
  family: {
    chinese: {
      explicit: [
        '父亲', '母亲', '爸爸', '妈妈', '爹', '娘',
        '儿子', '女儿', '孩子', '子女', '孩儿',
        '兄弟', '兄妹', '姐妹', '弟弟', '哥哥', '姐姐', '妹妹', '手足',
        '丈夫', '妻子', '老公', '老婆', '相公', '娘子', '郎君',
        '岳父', '岳母', '公公', '婆婆', '公婆',
        '爷爷', '奶奶', '外公', '外婆', '祖父', '祖母', '外祖父', '外祖母',
        '叔叔', '伯伯', '舅舅', '姨', '姑姑', '姑妈', '姑父',
        '侄子', '侄女', '外甥', '外甥女',
        '亲子', '父子', '母女', '母子', '父女',
        '结婚', '成亲', '嫁', '娶', '纳妾',
        '生育', '生出', '生下',
      ],
      dialogue: [
        '妈', '爸', '妈咪', '爹', '爹地', 'mom', 'dad',
        '娘', '母亲', '父亲',
        '孩儿', '孩子', '儿', '女儿', '儿子',
        '相公', '娘子', '夫君', '妻子',
        '老爷', '夫人', '少奶奶', '大少爷',
      ],
      action: [
        '抚养', '养育', '照顾', '生下', '生出',
        '结婚', '成亲', '嫁给', '娶了', '纳为',
        '亲吻', '拥抱', '牵手', '挽着',
      ],
    },
    english: {
      explicit: [
        'father', 'mother', 'dad', 'mom', 'parent',
        'son', 'daughter', 'child', 'children', 'kids',
        'brother', 'sister', 'siblings', 'bro', 'sis',
        'husband', 'wife', 'spouse', 'married',
        'uncle', 'aunt', 'cousin',
        'grandfather', 'grandmother', 'grandparent', 'grandma', 'grandpa',
        'nephew', 'niece',
        'married', 'wedding', 'married to', 'married with',
        'birth', 'born', 'gave birth', 'raised',
      ],
      dialogue: [
        'mom', 'dad', 'mother', 'father', 'mama', 'papa',
        'dear', 'honey', 'sweetheart', 'darling',
        'son', 'daughter', 'dear child',
      ],
      action: [
        'raised', 'raised by', 'gave birth', 'born to',
        'married', 'married to', 'wed', 'wedded',
        'kiss', 'kissed', 'embrace', 'hug', 'hugged', 'held',
      ],
    },
  },

  romantic: {
    chinese: {
      explicit: [
        '爱人', '恋人', '情人', '心爱的人', '心上人',
        '追求', '爱慕', '暗恋', '喜欢', '爱',
        '亲吻', '拥抱', '吻', '做爱',
      ],
      dialogue: [
        '亲爱的', '宝贝', '甜心', '心肝', '宝贝儿',
        '我爱你', 'love you', 'love',
        '想你了', '想念', '思恋',
      ],
      action: [
        '亲吻', '拥抱', '吻', '牵手', '挽着',
        '追求', '表白', '示爱', '求婚',
        '做爱', '同床', '共枕',
      ],
    },
    english: {
      explicit: [
        'lover', 'beloved', 'sweetheart', 'darling', 'dear',
        'love', 'loved', 'romantic', 'passion', 'passionate',
        'kiss', 'kissed', 'embrace', 'hug', 'hugged',
        'proposal', 'proposed', 'courted',
      ],
      dialogue: [
        'my love', 'my darling', 'my dear', 'beloved',
        'i love you', 'love you', 'love',
        'miss you', 'think of you', 'longing',
      ],
      action: [
        'kissed', 'embraced', 'hugged', 'held hands',
        'proposed', 'courted', 'wooed',
        'slept with', 'made love', 'intimate',
      ],
    },
  },

  friendship: {
    chinese: {
      explicit: [
        '朋友', '好友', '伙伴', '同伴', '友人',
        '故人', '旧友', '知音', '之交', '世交',
        '哥们', '兄弟伙', '铁哥们', '闺蜜', '死党',
        '友情', '友谊', '交情',
      ],
      dialogue: [
        '老朋友', '老兄', '兄弟', '哥们', '朋友',
        '故人', '旧友', '老弟', '老哥',
      ],
      action: [
        '聚餐', '共饮', '同行', '同游', '相伴',
        '交谈', '聊天', '叙旧',
      ],
    },
    english: {
      explicit: [
        'friend', 'friends', 'companion', 'buddy', 'pal',
        'best friend', 'close friend', 'old friend',
        'comrade', 'ally', 'partner',
        'friendship', 'amicable',
      ],
      dialogue: [
        'my friend', 'old friend', 'dear friend',
        'buddy', 'pal', 'mate', 'bro',
      ],
      action: [
        'dined with', 'ate with', 'walked with', 'talked with',
        'accompanied', 'spent time with', 'visited',
      ],
    },
  },

  antagonistic: {
    chinese: {
      explicit: [
        '敌人', '仇人', '仇家', '仇敌', '对手',
        '叛徒', '奸细', '内奸', '卖国贼',
        '恶人', '坏人', '歹人', '匪徒',
        '杀死', '杀害', '谋杀', '刺杀',
      ],
      dialogue: [
        '你这蠢货', '你这叛徒', '你这奸贼',
        '混蛋', '王八蛋', '狗贼',
      ],
      action: [
        '攻击', '杀害', '刺杀', '暗杀', '谋害',
        '背叛', '出卖', '陷害', '诬陷',
        '欺骗', '欺诈', '蒙骗',
      ],
    },
    english: {
      explicit: [
        'enemy', 'foe', 'adversary', 'rival', 'antagonist',
        'traitor', 'betrayer', 'backstabber', 'spy',
        'villain', 'evil', 'wicked', 'evil doer',
        'kill', 'killed', 'murder', 'murdered', 'assassinate',
      ],
      dialogue: [
        'you fool', 'you traitor', 'you villain', 'you liar',
        'damn you', 'you scoundrel', 'you bastard',
      ],
      action: [
        'attacked', 'killed', 'murdered', 'assassinated',
        'betrayed', 'sold out', 'framed', 'tricked',
        'deceived', 'lied to', 'cheated',
      ],
    },
  },
};

/**
 * Family relationship subtypes
 */
export const FAMILY_SUBTYPES = {
  parent: ['父亲', '母亲', '爸爸', '妈妈', '爹', '娘', 'father', 'mother', 'dad', 'mom', 'parent'],
  child: ['儿子', '女儿', '孩子', '子女', '孩儿', 'son', 'daughter', 'child', 'children'],
  sibling: ['兄弟', '姐妹', '兄妹', '兄妹', 'brother', 'sister', 'sibling', 'siblings'],
  spouse: ['丈夫', '妻子', '老婆', '老公', '相公', '娘子', 'husband', 'wife', 'spouse'],
  grandparent: ['爷爷', '奶奶', '外公', '外婆', '祖父', '祖母', 'grandfather', 'grandmother', 'grandparent'],
  extended: ['叔叔', '伯伯', '舅舅', '姨', '姑姑', '姑妈', 'uncle', 'aunt', 'cousin', 'nephew', 'niece'],
};
