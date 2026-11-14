'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [pw, setPw] = useState('');

  const create = () => {
    const id = crypto.randomUUID().slice(0, 8);
    if (pw) sessionStorage.setItem(`pw:${id}`, pw);
    router.push(`/room/${id}`);
  };

  return (
    <main className="center">
      <div className="card hero">
        <div className="logo">🎧</div>
        <h1 className="gradient-text">Listen Together</h1>
        <p>Build a shared queue and listen to YouTube songs in perfect sync with your friends.</p>

        <div className="stack">
          <input
            className="input"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Room password (optional)"
          />
          <button className="btn" onClick={create}>Create a room</button>
        </div>

        <div className="chips">
          <span className="chip">Real-time sync</span>
          <span className="chip">Shared queue</span>
          <span className="chip">Drag to reorder</span>
        </div>
      </div>
    </main>
  );
}