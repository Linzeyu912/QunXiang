/**
 * 亲属称谓归一与等价判定。
 *
 * 跨批提取时同一亲属常被写成不同称谓（"X的妈妈"/"X的母亲"），精确名称
 * 匹配合并不了。这里提供三类能力，供提取器去重、别名清洗（alias-safety）
 * 共用同一份词表，避免两处规则漂移：
 * - kinshipNormalize：把"X的Y"的亲属后缀 Y 归一到组内规范形式
 * - isKinshipEquivalentName：两个"X的Y"名称是否指同一亲属（同人前缀 + 同组称谓）
 * - KINSHIP_COLLECTIVE：集合称谓组（"X的父母"），在父母均已单独存在时视为冗余
 */

const KINSHIP_GROUPS: Array<{ canonical: string; variants: string[] }> = [
  { canonical: '母亲', variants: ['妈妈', '妈', '老妈', '母亲'] },
  { canonical: '父亲', variants: ['爸爸', '爸', '爹', '老爸', '父亲'] },
  { canonical: '哥哥', variants: ['哥哥', '哥', '大哥'] },
  { canonical: '姐姐', variants: ['姐姐', '姐', '大姐'] },
  { canonical: '弟弟', variants: ['弟弟', '弟'] },
  { canonical: '妹妹', variants: ['妹妹', '妹'] },
  { canonical: '爷爷', variants: ['爷爷', '爷'] },
  { canonical: '奶奶', variants: ['奶奶', '奶'] },
  { canonical: '叔叔', variants: ['叔叔', '叔'] },
  { canonical: '婶婶', variants: ['婶婶', '婶'] },
  { canonical: '父母', variants: ['父母', '爸妈', '双亲', '父母亲'] },
];

/** 集合称谓（不指单一亲属）的规范名 */
export const KINSHIP_COLLECTIVE = '父母';

function splitKinshipName(name: string): { prefix: string; suffix: string } | null {
  const idx = name.lastIndexOf('的');
  if (idx <= 0 || idx === name.length - 1) return null;
  return { prefix: name.slice(0, idx), suffix: name.slice(idx + 1) };
}

/** 把"X的Y"的亲属后缀归一到组内规范形式；未命中词表的原样返回。 */
export function kinshipNormalize(name: string): string {
  const parts = splitKinshipName(name);
  if (!parts) return name;
  for (const group of KINSHIP_GROUPS) {
    if (group.variants.includes(parts.suffix)) return `${parts.prefix}的${group.canonical}`;
  }
  return name;
}

/** 两个名称是否指同一亲属：同人前缀 + 称谓属于同一组（如 妈妈≡母亲）。 */
export function isKinshipEquivalentName(a: string, b: string): boolean {
  const pa = splitKinshipName(a);
  const pb = splitKinshipName(b);
  if (!pa || !pb) return false;
  if (pa.prefix !== pb.prefix) return false;
  return KINSHIP_GROUPS.some(
    (group) => group.variants.includes(pa.suffix) && group.variants.includes(pb.suffix),
  );
}

/** 名称是否为集合称谓（"X的父母"这类不指单一亲属的行）。 */
export function isKinshipCollectiveName(name: string): boolean {
  const parts = splitKinshipName(name);
  if (!parts) return false;
  return parts.suffix === KINSHIP_COLLECTIVE;
}

/** 名称是否为亲属称谓名（"X的Y"且 Y 命中亲属词表，含规范形与变体）。 */
export function isKinshipName(name: string): boolean {
  const parts = splitKinshipName(name);
  if (!parts) return false;
  return KINSHIP_GROUPS.some((group) => group.variants.includes(parts.suffix));
}
