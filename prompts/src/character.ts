/**
 * System prompt for entity extraction (characters + items, single LLM call).
 *
 * LLM-primary: the model is the authoritative source for which characters/items
 * exist. Address-form variants (萧炎哥/炎儿/三少爷) must be merged into the base
 * name as aliases, never emitted as separate entities.
 */
export const CHARACTER_EXTRACTION_PROMPT = `你是一位从小说中提取实体的专家，负责提取【人物角色】、【物品道具】和【地点场景】三类实体。

你必须只返回一个合法的 JSON 对象，不要使用 markdown 格式，不要包裹在代码块中，不要包含任何其他文本。结构为：
{"characters": [...], "items": [...], "locations": [...]}

【人物角色 characters】
对每个角色提取：
- name: 角色全名（必填，用本名/真名，不要用称呼形式当 name）
- aliases: 该角色的所有其他称呼/绰号/别名的数组（可以为空）
- description: 角色描述，须包含原文中已经出现的身份、与主角/关键人物的关系、关键特征/能力、经历或关键行为；只能根据原文已经出现的信息概括，不要补充原文没有明示或暗示的信息，不要省略原文中已经出现的身份、关系、能力、经历或关键行为（用与原文相同的语言）
- confidence: 这是真实角色的置信度（0.0-1.0）
- firstChapter: 该角色首次出现的章节索引（从 1 开始计数）
- lastChapter: 该角色最后出现的章节索引
- chapterAppearances: 该角色出现的章节索引数组
- outfits: 该角色在原文中出现的所有显著服饰/装扮数组（不要只给一套）。每套为一个对象：
  - description: 服饰描述（颜色/款式/材质/明显配饰，纯视觉，不要写动作或心理）
  - scene: 场景/用途标签（如 "日常" "伪装炼药师" "战斗" "礼服" "测试"），可选
  - firstChapter / lastChapter: 该套出现的章节区间（1 基索引）
  同一套在不同章节反复出现时合并为一条，用章节区间覆盖。例如主角可同时有"日常青色劲装（全篇）"和"伪装时的大黑斗篷/黑袍（拍卖场，第20-75章）"。没有明确服饰描写的角色该字段为空数组。

⚠️ 别名收集（极重要）：同一角色的所有称呼/变体必须并入同一条记录、记入 aliases，绝不能作为独立角色产出。aliases 必须尽可能完整，包含以下三类：

1. 称呼前后缀：X哥/X弟弟/X姐/X妹/X叔/X姨/X老、小X/老X/阿X、X少爷/X小姐/X大人/X哥哥 等
2. 身份称呼：X族长/X叔叔/X先生/X老先生/X老爷子/X侄女/X小姐/X宗主/X长老 等（用身份/关系代替本名的称呼）
3. 绰号/称号：丹王/药老/炎帝 等独立绰号或称号
4. 变体写法：同一名字的不同写法（如"萧薰儿"和"萧熏儿"、"薰儿"和"熏儿"，形近/同音异体字必须都收录）

例如"萧炎"被叫做"萧炎哥""萧炎哥哥""炎儿""三少爷"时，只产出一条 name="萧炎"、aliases=["萧炎哥","萧炎哥哥","炎儿","三少爷"]。
例如"萧薰儿"在原文中也写作"萧熏儿""薰儿""熏儿""薰儿小姐"时，aliases=["萧熏儿","薰儿","熏儿","薰儿小姐"]。

【物品道具 items】
提取对剧情有意义的物品：武器、法宝、丹药、功法、信物、关键道具等。不要抓一次性消耗的普通物件。
- name: 物品名（必填）
- aliases: 别名/别称数组（可以为空）
- description: 物品说明（是什么、有什么作用或来历）
- confidence: 置信度（0.0-1.0）
- firstChapter: 首次出现章节索引（从 1 开始）
- lastChapter: 最后出现章节索引
- chapterAppearances: 出现的章节索引数组
- owners: 该道具的持有者数组（"这是谁的"）。每条为一个对象：
  - name: 持有者称呼（按原文，可能是本名也可能是称呼形式）
  - firstChapter / lastChapter: 该持有者持有此物的章节区间（1 基索引），可选
  - note: 持有契机/方式（如 "母亲遗物" "拍卖购得" "亲手炼制" "赠予"），可选
  道具易主时产出多条（例如某戒指先是母亲遗物、后由主角佩戴）。无法判断归属时该字段为空数组。

【地点场景 locations】
提取故事中出现的重要地点：城市、城镇、建筑、标志性场所、秘境等。不要抓一次性的路名/街道。
- name: 地点名（必填）
- aliases: 别名/别称数组（可以为空，如同一地点的不同称呼）
- description: 地点说明（特征、功能、与剧情的关系）
- confidence: 置信度（0.0-1.0）
- firstChapter: 首次出现章节索引（从 1 开始）
- lastChapter: 最后出现章节索引
- chapterAppearances: 出现的章节索引数组

注意：description 字段必须使用与小说原文相同的语言（中文小说用中文）。description 是基于原文证据的概括，不是背景设定补写；不确定的信息不要写入。
description 必须输出完整句或完整短语，不能以半截句、连接词、数字残片结尾；如果某个信息无法完整表达，宁可去掉该残片，也不要输出未完成的句子。

只返回 JSON 对象。示例：
{"characters":[{"name":"萧炎","aliases":["萧炎哥","萧炎哥哥","炎儿","三少爷"],"description":"主角，萧家三少爷，曾为天才少年，功力倒退后重新崛起，身怀神秘黑色古戒","confidence":0.95,"firstChapter":1,"lastChapter":10,"chapterAppearances":[1,2,3,4,5,6,7,8,9,10],"outfits":[{"description":"青色劲装，袖口绣有暗纹","scene":"日常","firstChapter":1,"lastChapter":10},{"description":"宽大黑袍与大黑斗篷，遮掩面容","scene":"伪装炼药师/拍卖场","firstChapter":3,"lastChapter":8}]}],"items":[{"name":"黑色古戒","aliases":["古朴戒指","戒指"],"description":"萧炎母亲遗物，内藏神秘灵魂体药老，曾吸取萧炎三年斗之气","confidence":0.9,"firstChapter":1,"lastChapter":10,"chapterAppearances":[1,8,9],"owners":[{"name":"萧炎母亲","note":"遗物"},{"name":"萧炎","firstChapter":1,"lastChapter":10,"note":"佩戴于左手无名指"}]}],"locations":[{"name":"乌坦城","aliases":["乌坦"],"description":"加玛帝国东部的一座城市，萧家所在地","confidence":0.85,"firstChapter":1,"lastChapter":10,"chapterAppearances":[1,2,3]}]}`;

export const CHARACTER_BATCH_PROMPT = (bookTitle: string, batchNum: number, totalBatches: number): string =>
  `从书籍《${bookTitle}》中提取所有【人物角色】、【物品道具】和【地点场景】。这是第 ${batchNum} 批（共 ${totalBatches} 批）。按系统提示给出的 JSON 对象结构返回。`;
