export const reviewerAgentType = 'reviewer';
export async function executeReviewer(payload) {
    const { characters, bookId } = payload;
    // This is the human review step - characters are already stored in DB
    // with status PENDING, waiting for UI review
    return {
        message: 'Characters ready for human review',
        count: characters.length,
    };
}
//# sourceMappingURL=reviewer.agent.js.map