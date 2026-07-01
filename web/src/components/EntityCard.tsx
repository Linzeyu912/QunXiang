import { useState } from 'react';
import { CheckCircle, XCircle, Edit3, Save, X } from 'lucide-react';
import type { Character, Location, Item } from '../api/client';

type Entity = Character | Location | Item;
type EntityType = 'character' | 'location' | 'item';

function isImportanceEntity(entity: Entity): entity is Location | Item {
  return 'importanceScore' in entity;
}

function TierBadge({ tier }: { tier: string }) {
  const config = {
    core: { label: '核心', cls: 'bg-purple-100 text-purple-700' },
    supporting: { label: '支撑', cls: 'bg-blue-100 text-blue-700' },
    candidate: { label: '候选', cls: 'bg-gray-100 text-gray-600' },
    archived: { label: '归档', cls: 'bg-gray-50 text-gray-400' },
  }[tier] || { label: tier, cls: 'bg-gray-100 text-gray-600' };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.cls}`}>
      {config.label}
    </span>
  );
}

function ImportanceDisplay({ entity }: { entity: Location | Item }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[#94A3B8] mt-2">
      <span className="font-medium text-[#6366F1]">
        重要性 {(entity.importanceScore * 100).toFixed(0)}%
      </span>
      <span>故事分 {entity.storyScore}/6</span>
      <span title="因果必要性">因果 {entity.pillarCausal}</span>
      <span title="信息唯一性">唯一 {entity.pillarUniqueness}</span>
      <span title="状态转折性">转折 {entity.pillarTransition}</span>
      <span>提及 {entity.mentionCount}次</span>
      {entity.firstChapter != null && (
        <span>章节 {entity.firstChapter}-{entity.lastChapter}</span>
      )}
    </div>
  );
}

interface EntityCardProps {
  entity: Entity;
  entityType: EntityType;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (id: string, data: Partial<Entity>) => void;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}

export function EntityCard({
  entity,
  entityType,
  onApprove,
  onReject,
  onEdit,
  isSelected,
  onToggleSelect,
}: EntityCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(entity.name);
  const [editAliases, setEditAliases] = useState(entity.aliases.join(', '));
  const [editDesc, setEditDesc] = useState(entity.description || '');

  const statusBorder = {
    PENDING: 'border-l-4 border-yellow-400',
    APPROVED: 'border-l-4 border-green-400',
    REJECTED: 'border-l-4 border-red-400',
  }[entity.status];

  const statusBadge = {
    PENDING: { text: '待审核', cls: 'bg-yellow-100 text-yellow-700' },
    APPROVED: { text: '已通过', cls: 'bg-green-100 text-green-700' },
    REJECTED: { text: '已拒绝', cls: 'bg-red-100 text-red-700' },
  }[entity.status];

  const handleSave = () => {
    onEdit(entity.id, {
      name: editName,
      aliases: editAliases.split(',').map((s) => s.trim()).filter(Boolean),
      description: editDesc,
    } as Partial<Entity>);
    setIsEditing(false);
  };

  return (
    <div
      className={`bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-all duration-200 ${statusBorder} ${isSelected ? 'ring-2 ring-[#3B82F6] ring-offset-1' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onToggleSelect(entity.id)}
            className={`w-5 h-5 rounded border transition-colors flex items-center justify-center ${
              isSelected
                ? 'bg-[#2563EB] border-[#2563EB]'
                : 'border-gray-300 hover:border-[#3B82F6]'
            }`}
          >
            {isSelected && <CheckCircle size={14} className="text-white" />}
          </button>
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="text-lg font-semibold text-[#0F172A] border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/20"
            />
          ) : (
            <h3 className="text-lg font-semibold text-[#0F172A]">{entity.name}</h3>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isImportanceEntity(entity) && <TierBadge tier={entity.tier} />}
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadge.cls}`}>
            {statusBadge.text}
          </span>
          <span className="text-xs text-[#94A3B8]">
            置信度 {(entity.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs text-[#94A3B8] mb-1 block">别名（逗号分隔）</label>
            <input
              type="text"
              value={editAliases}
              onChange={(e) => setEditAliases(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/20"
            />
          </div>
          <div>
            <label className="text-xs text-[#94A3B8] mb-1 block">描述</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/20 resize-none"
            />
          </div>
        </div>
      ) : (
        <>
          {entity.aliases.length > 0 && (
            <div className="mb-2">
              <span className="text-xs text-[#94A3B8] uppercase tracking-wider">别名</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {entity.aliases.map((a) => (
                  <span key={a} className="px-2 py-0.5 bg-[#F1F5F9] text-[#334155] text-xs rounded-md">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {entity.description && (
            <div className="mb-3">
              <span className="text-xs text-[#94A3B8] uppercase tracking-wider">描述</span>
              <p className="text-sm text-[#334155] mt-1 leading-relaxed">{entity.description}</p>
            </div>
          )}
          {isImportanceEntity(entity) && <ImportanceDisplay entity={entity} />}
        </>
      )}

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-50">
        {entity.status === 'PENDING' && !isEditing && (
          <>
            <button
              onClick={() => onApprove(entity.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#ECFDF5] text-green-700 hover:bg-green-100 transition-colors"
            >
              <CheckCircle size={14} />
              通过
            </button>
            <button
              onClick={() => onReject(entity.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
            >
              <XCircle size={14} />
              拒绝
            </button>
          </>
        )}
        {isEditing ? (
          <>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors"
            >
              <Save size={14} />
              保存
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
            >
              <X size={14} />
              取消
            </button>
          </>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
          >
            <Edit3 size={14} />
            编辑
          </button>
        )}
      </div>
    </div>
  );
}
