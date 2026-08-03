/** 通用题材分类（参考主流小说站） */
export const GENRE_TAGS = [
  '都市', '玄幻', '仙侠', '武侠', '科幻', '奇幻',
  '历史', '军事', '游戏', '体育', '悬疑', '灵异',
  '现实', '言情', '轻小说',
] as const;

/** 热门标签展示上限 */
export const POPULAR_TAGS_LIMIT = 30;

/** 判断一个标签是否属于预置题材 */
export function isGenreTag(tag: string): boolean {
  return (GENRE_TAGS as readonly string[]).includes(tag);
}
