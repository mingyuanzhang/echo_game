/**
 * The end of the game. Deliberately the plainest screen in it: after twenty-five rooms
 * of inferring shapes from fragments, a plain sentence that says you are out is the
 * right reward, and anything more would be the game congratulating itself.
 */
export function AllClear({
  levels,
  onProgress,
  onAgain,
}: {
  levels: number;
  onProgress: () => void;
  onAgain: () => void;
}) {
  return (
    <div className="overlay overlay--solid overlay--center">
      <h2 className="overlay__title is-good all-clear__title">ALL CLEAR</h2>
      <p className="overlay__line">
        {levels} rooms, and you heard your way out of every one.
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={onProgress}>
          THE RECORD
        </button>
        <button type="button" className="btn" onClick={onAgain}>
          START AGAIN
        </button>
      </div>
    </div>
  );
}
