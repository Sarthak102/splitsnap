// Pieces of torn receipt falling. Positions come from the index so every render is identical.
const PIECES = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 13) % 10) / 20,
  duration: 1.4 + ((i * 7) % 8) / 10,
  turn: 180 + ((i * 53) % 360),
}));

export default function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {PIECES.map((piece, i) => (
        <i key={i} className={i % 3 === 0 ? 'ink' : i % 3 === 1 ? 'paper' : ''} style={{
          left: `${piece.left}%`,
          animationDelay: `${piece.delay}s`,
          animationDuration: `${piece.duration}s`,
          ['--turn' as string]: `${piece.turn}deg`,
        }} />
      ))}
    </div>
  );
}
