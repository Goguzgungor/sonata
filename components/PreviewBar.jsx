export default function PreviewBar() {
  return (
    <div className="preview-bar" role="note">
      <span className="preview-bar__dot" aria-hidden="true" />
      <span>Preview build · sample data<span className="preview-bar__long"> · nothing is sent to the network</span></span>
    </div>
  );
}
