import type { Relationship, RelationshipType } from '@novel-agent/schemas';

export interface CharacterNode {
  id: string;
  name: string;
  aliases: string[];
  mentionCount: number;
  firstChapter: number;
  lastChapter: number;
  relationships: string[]; // IDs of related characters
}

export interface RelationshipEdge {
  id: string;
  source: string; // CharacterNode ID
  target: string; // CharacterNode ID
  type: RelationshipType;
  confidence: number;
  chapterFirst?: number;
  chapterLast?: number;
  evidence: string[];
}

export interface RelationshipQuery {
  character?: string;
  type?: RelationshipType;
  minConfidence?: number;
  chapterRange?: { start: number; end: number };
}

/**
 * Character Knowledge Graph
 * Stores characters and their relationships for querying
 */
export class CharacterKnowledgeGraph {
  private nodes: Map<string, CharacterNode> = new Map();
  private edges: Map<string, RelationshipEdge> = new Map();
  private nameToId: Map<string, string> = new Map();

  /**
   * Add a character to the graph
   */
  addCharacter(
    id: string,
    name: string,
    aliases: string[] = [],
    mentionCount = 0,
    firstChapter?: number,
    lastChapter?: number
  ): void {
    if (this.nodes.has(id)) return;

    const node: CharacterNode = {
      id,
      name,
      aliases,
      mentionCount,
      firstChapter: firstChapter ?? 0,
      lastChapter: lastChapter ?? 0,
      relationships: [],
    };

    this.nodes.set(id, node);
    this.nameToId.set(name.toLowerCase(), id);

    for (const alias of aliases) {
      this.nameToId.set(alias.toLowerCase(), id);
    }
  }

  /**
   * Add a relationship edge
   */
  addRelationship(
    subjectId: string,
    objectId: string,
    type: RelationshipType,
    confidence: number,
    evidence: string[] = [],
    chapterFirst?: number,
    chapterLast?: number
  ): void {
    const edgeId = `${subjectId}__${objectId}__${type}`;

    if (this.edges.has(edgeId)) {
      // Update existing
      const existing = this.edges.get(edgeId)!;
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.evidence.push(...evidence);
      if (chapterFirst && (!existing.chapterFirst || chapterFirst < existing.chapterFirst)) {
        existing.chapterFirst = chapterFirst;
      }
      if (chapterLast && (!existing.chapterLast || chapterLast > existing.chapterLast)) {
        existing.chapterLast = chapterLast;
      }
    } else {
      // Create new
      this.edges.set(edgeId, {
        id: edgeId,
        source: subjectId,
        target: objectId,
        type,
        confidence,
        evidence,
        chapterFirst,
        chapterLast,
      });

      // Update node relationships
      const subjectNode = this.nodes.get(subjectId);
      if (subjectNode && !subjectNode.relationships.includes(objectId)) {
        subjectNode.relationships.push(objectId);
      }
    }
  }

  /**
   * Get node by ID
   */
  getNode(id: string): CharacterNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get node by name
   */
  getNodeByName(name: string): CharacterNode | undefined {
    const id = this.nameToId.get(name.toLowerCase());
    return id ? this.nodes.get(id) : undefined;
  }

  /**
   * Get all edges
   */
  getEdges(): RelationshipEdge[] {
    return Array.from(this.edges.values());
  }

  /**
   * Query relationships
   */
  queryRelationships(query: RelationshipQuery): RelationshipEdge[] {
    let results = Array.from(this.edges.values());

    if (query.character) {
      const charId = this.nameToId.get(query.character.toLowerCase());
      if (charId) {
        results = results.filter(
          e => e.source === charId || e.target === charId
        );
      }
    }

    if (query.type) {
      results = results.filter(e => e.type === query.type);
    }

    if (query.minConfidence !== undefined) {
      results = results.filter(e => e.confidence >= query.minConfidence!);
    }

    if (query.chapterRange) {
      results = results.filter(e => {
        if (!e.chapterFirst || !e.chapterLast) return true;
        return (
          e.chapterFirst <= query.chapterRange!.end &&
          e.chapterLast >= query.chapterRange!.start
        );
      });
    }

    return results;
  }

  /**
   * Get relationship timeline between two characters
   */
  getRelationshipTimeline(
    char1Name: string,
    char2Name: string
  ): RelationshipEdge[] {
    const char1Id = this.nameToId.get(char1Name.toLowerCase());
    const char2Id = this.nameToId.get(char2Name.toLowerCase());

    if (!char1Id || !char2Id) return [];

    return Array.from(this.edges.values())
      .filter(
        e =>
          (e.source === char1Id && e.target === char2Id) ||
          (e.source === char2Id && e.target === char1Id)
      )
      .sort((a, b) => {
        const aChapter = a.chapterFirst ?? 0;
        const bChapter = b.chapterFirst ?? 0;
        return aChapter - bChapter;
      });
  }

  /**
   * Infer potential relationships
   */
  inferRelationships(charId: string): { type: RelationshipType; target: string; confidence: number }[] {
    const inferred: { type: RelationshipType; target: string; confidence: number }[] = [];
    const node = this.nodes.get(charId);

    if (!node) return inferred;

    // Get direct relationships
    const directRels = this.queryRelationships({ character: node.name });

    // Infer transitivity (friend of friend)
    for (const rel of directRels) {
      if (rel.type === 'friendship') {
        const targetId = rel.source === charId ? rel.target : rel.source;
        const targetNode = this.nodes.get(targetId);

        if (targetNode) {
          const targetFriends = this.queryRelationships({
            character: targetNode.name,
            type: 'friendship',
          });

          for (const friendOfFriend of targetFriends) {
            const foafId = friendOfFriend.source === targetId
              ? friendOfFriend.target
              : friendOfFriend.source;

            if (foafId !== charId && !this.nodes.get(foafId)) {
              inferred.push({
                type: 'friendship',
                target: foafId,
                confidence: rel.confidence * 0.5, // Transitive reduction
              });
            }
          }
        }
      }
    }

    return inferred;
  }

  /**
   * Export graph for visualization
   */
  exportGraph(): { nodes: CharacterNode[]; edges: RelationshipEdge[] } {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    relationshipCounts: Record<RelationshipType, number>;
  } {
    const relationshipCounts: Record<RelationshipType, number> = {
      family: 0,
      romantic: 0,
      friendship: 0,
      antagonistic: 0,
      professional: 0,
      narrative: 0,
      unknown: 0,
    };

    for (const edge of this.edges.values()) {
      relationshipCounts[edge.type]++;
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      relationshipCounts,
    };
  }
}

/**
 * Build a knowledge graph from characters and relationships
 */
export function buildKnowledgeGraph(
  characters: Array<{
    id: string;
    name: string;
    aliases?: string[];
    mentionCount?: number;
    firstChapter?: number;
    lastChapter?: number;
  }>,
  relationships: Relationship[]
): CharacterKnowledgeGraph {
  const graph = new CharacterKnowledgeGraph();

  // Add characters
  for (const char of characters) {
    graph.addCharacter(
      char.id,
      char.name,
      char.aliases || [],
      char.mentionCount || 0,
      char.firstChapter,
      char.lastChapter
    );
  }

  // Add relationships
  for (const rel of relationships) {
    const subjectId = characters.find(c => c.name === rel.subject)?.id || rel.subject;
    const objectId = characters.find(c => c.name === rel.object)?.id || rel.object;

    graph.addRelationship(
      subjectId,
      objectId,
      rel.type,
      rel.confidence,
      rel.evidence.map(e => e.text),
      rel.chapterFirst,
      rel.chapterLast
    );
  }

  return graph;
}
