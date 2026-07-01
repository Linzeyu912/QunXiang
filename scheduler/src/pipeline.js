export const EXTRACTION_PIPELINE = [
    'extractor',
    'validator',
    'entity-resolution',
    'description-fusion',
    'visual-description',
    'reviewer',
];
export function getNextAgent(current) {
    const index = EXTRACTION_PIPELINE.indexOf(current);
    if (index === -1 || index === EXTRACTION_PIPELINE.length - 1) {
        return null;
    }
    return EXTRACTION_PIPELINE[index + 1];
}
//# sourceMappingURL=pipeline.js.map
