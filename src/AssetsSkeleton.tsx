import './AssetsSkeleton.css'

function SkeletonBox({ width, height, style }: { width?: string; height?: string; style?: React.CSSProperties }) {
  return (
    <div
      className="skeleton-box"
      style={{ width: width ?? '100%', height: height ?? '14px', ...style }}
    />
  )
}

function SkeletonSummaryCard() {
  return (
    <div className="skeleton-summary-card">
      <div className="skeleton-summary-total">
        <SkeletonBox width="80px" height="14px" />
        <SkeletonBox width="130px" height="26px" />
      </div>
      <div className="skeleton-summary-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-summary-cell">
            <SkeletonBox width="60px" height="11px" />
            <SkeletonBox width="80px" height="15px" />
          </div>
        ))}
      </div>
    </div>
  )
}

function SkeletonSectionHeader() {
  return (
    <div className="skeleton-section-header">
      <SkeletonBox width="80px" height="14px" />
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <SkeletonBox width="100px" height="26px" style={{ borderRadius: '8px' }} />
        <SkeletonBox width="56px" height="26px" style={{ borderRadius: '6px' }} />
      </div>
    </div>
  )
}

function SkeletonAssetItem() {
  return (
    <div className="skeleton-asset-item">
      <div className="skeleton-row1">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <SkeletonBox width="90px" height="15px" />
          <SkeletonBox width="40px" height="11px" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <SkeletonBox width="70px" height="15px" />
          <SkeletonBox width="80px" height="20px" style={{ borderRadius: '4px' }} />
        </div>
      </div>
      <div className="skeleton-row2">
        <SkeletonBox width="120px" height="12px" />
        <SkeletonBox width="80px" height="12px" />
      </div>
    </div>
  )
}

export function AssetsSkeleton() {
  return (
    <div className="assets-view">
      <SkeletonSummaryCard />
      <SkeletonSectionHeader />
      <div className="skeleton-asset-list">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonAssetItem key={i} />
        ))}
      </div>
    </div>
  )
}
