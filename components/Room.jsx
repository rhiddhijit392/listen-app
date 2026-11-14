'use client';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// autoConnect is off so nothing connects during Next's server-side render
const socket = io(process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001', {
    autoConnect: false,
});

/* ---------- small helpers ---------- */
const fmt = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
};

const COLORS = ['#8b5cf6', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#3b82f6'];
const colorFor = (name = '') =>
    COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

/* ---------- icons ---------- */
const Icon = ({ d }) => (
    <svg viewBox="0 0 24 24"><path d={d} /></svg>
);
const PLAY = 'M8 5v14l11-7z';
const PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';
const PREV = 'M6 6h2v12H6zM9.5 12L18 18V6z';
const NEXT = 'M16 6h2v12h-2zM6 18l8.5-6L6 6z';
const BACK = 'M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z';
const FWD = 'M12 5V1l5 5-5 5V7c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6h2c0 4.4-3.6 8-8 8s-8-3.6-8-8 3.6-8 8-8z';

/* ---------- queue row ---------- */
function SortableSong({ song, isCurrent, onSelect, onRemove }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: song.id });

    return (
        <li
            ref={setNodeRef}
            className={`song${isCurrent ? ' current' : ''}`}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.6 : 1,
            }}
        >
            <span className="handle" {...attributes} {...listeners} title="Drag to reorder">⠿</span>
            <img className="thumb" src={`https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`} alt="" />
            <div className="song-info" onClick={onSelect}>
                <div className="song-title">{song.title}</div>
                <div className="song-by">{isCurrent ? '▶ Now playing · ' : ''}added by {song.addedBy}</div>
            </div>
            <button className="remove" onClick={onRemove} title="Remove">✕</button>
        </li>
    );
}

/* ---------- room ---------- */
export default function Room({ roomId }) {
    const [joined, setJoined] = useState(false);
    const [name, setName] = useState('');
    const [pw, setPw] = useState('');
    const [state, setState] = useState({ queue: [], index: -1, playing: false, position: 0 });
    const [members, setMembers] = useState([]);
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [progress, setProgress] = useState({ t: 0, d: 0, ps: -1 });
    const [scrub, setScrub] = useState(null);
    const player = useRef(null);
    const ready = useRef(false);
    const loadedId = useRef(null);
    const stateRef = useRef(state);
    const [native, setNative] = useState(false);
    const nativeRef = useRef(false);
    nativeRef.current = native;
    const wrapRef = useRef(null);
    const seekTarget = useRef(null);
    const seekHold = useRef(0);
    const lastTick = useRef(null);
    const lastLocalSeek = useRef(0);
    stateRef.current = state;

    const current = state.queue[state.index];
    const send = (type, payload = {}) => socket.emit(type, { roomId, ...payload });
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    // Connect the socket and listen for server updates
    useEffect(() => {
        socket.connect();
        socket.on('state', setState);
        socket.on('presence', setMembers);
        return () => {
            socket.off('state', setState);
            socket.off('presence', setMembers);
            socket.disconnect();
        };
    }, []);

    // Pre-fill saved name and the password set on the home page
    useEffect(() => {
        setName(localStorage.getItem('name') || '');
        setPw(sessionStorage.getItem(`pw:${roomId}`) || '');
    }, [roomId]);

    // Create the YouTube player after joining
    useEffect(() => {
        if (!joined) return;

        const init = () => {
            player.current = new window.YT.Player('yt-player', {
                width: '100%',
                height: '100%',
                playerVars: { controls: 1, disablekb: 1, playsinline: 1, modestbranding: 1, rel: 0 },
                events: {
                    onReady: () => {
                        ready.current = true;
                        socket.emit('sync', { roomId });
                    },
                    onStateChange: (e) => {
                        const s = stateRef.current;
                        const cur = s.queue[s.index];
                        if (e.data === window.YT.PlayerState.ENDED && cur) {
                            socket.emit('ended', { roomId, itemId: cur.id });
                        }
                        // With YouTube's controls visible, forward its play/pause to the room
                        if (nativeRef.current && cur) {
                            if (e.data === window.YT.PlayerState.PAUSED && s.playing) socket.emit('pause', { roomId });
                            if (e.data === window.YT.PlayerState.PLAYING && !s.playing) socket.emit('play', { roomId });
                        }
                    },
                }
            });
        };

        if (window.YT?.Player) init();
        else {
            window.onYouTubeIframeAPIReady = init;
            const s = document.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(s);
        }

        return () => {
            player.current?.destroy?.();
            player.current = null;
            ready.current = false;
            loadedId.current = null;
        };
    }, [joined, roomId]);

    // Apply server state to the player
    useEffect(() => {
        const p = player.current;
        if (!ready.current || !p) return;

        if (!current) {
            loadedId.current = null;
            p.stopVideo();
            return;
        }
        if (loadedId.current !== current.id) {
            loadedId.current = current.id;
            p.loadVideoById(current.videoId, state.position);
        } else if (Math.abs(p.getCurrentTime() - state.position) > 0.7) {
            p.seekTo(state.position, true);
        }
        state.playing ? p.playVideo() : p.pauseVideo();
    }, [state]);

    // Progress bar (display only)
    useEffect(() => {
        if (!joined) return;
        const timer = setInterval(() => {
            const p = player.current;
            if (!ready.current || !p?.getCurrentTime) return;

            const now = Date.now();
            const playerT = Number(p.getCurrentTime()) || 0;
            const d = Number(p.getDuration()) || 0;
            const ps = p.getPlayerState?.() ?? -1;

            const last = lastTick.current;
            if (nativeRef.current && last && ps === 1 && last.ps === 1 && now > seekHold.current) {
                const expected = last.t + (now - last.at) / 1000;
                if (Math.abs(playerT - expected) > 2) {
                    seekHold.current = now + 1500;
                    socket.emit('seek', { roomId, position: playerT });
                }
            }
            lastTick.current = { t: playerT, at: now, ps };

            let t = playerT;
            const tgt = seekTarget.current;
            if (tgt) {
                const expected = tgt.pos + (stateRef.current.playing ? (now - tgt.at) / 1000 : 0);
                if (now - tgt.at < 2500 && Math.abs(playerT - expected) > 1.5) t = expected;
                else seekTarget.current = null;
            }

            setProgress({ t, d, ps });
        }, 500);
        return () => clearInterval(timer);
    }, [joined, roomId]);

    const join = () => {
        socket.emit('join', { roomId, name: name.trim(), password: pw }, (res) => {
            if (res?.error) return setError(res.error);
            localStorage.setItem('name', name.trim());
            setError('');
            setJoined(true);
        });
    };

    const addSong = () => {
        if (!url.trim()) return;
        socket.emit('add', { roomId, url }, (res) => {
            if (res?.error) setError(res.error);
            else { setError(''); setUrl(''); }
        });
    };

    const onDragEnd = ({ active, over }) => {
        if (!over || active.id === over.id) return;
        const toIndex = state.queue.findIndex((q) => q.id === over.id);
        send('reorder', { itemId: active.id, toIndex });
    };

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch { }
    };
    const goFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else wrapRef.current?.requestFullscreen?.();
    };
    const commitSeek = () => {
        if (scrub === null) return;
        const pos = scrub;
        const now = Date.now();
        seekHold.current = now + 1500;
        seekTarget.current = { pos, at: now };
        player.current?.seekTo(pos, true);
        setProgress((p) => ({ ...p, t: pos }));
        send('seek', { position: pos });
        setScrub(null);
    };
    /* ----- join screen ----- */
    if (!joined) {
        return (
            <main className="center">
                <div className="card hero">
                    <div className="logo">🎧</div>
                    <h1 className="gradient-text">Join the room</h1>
                    <p>Enter your name to start listening together.</p>
                    <div className="stack">
                        <input
                            className="input"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Your name"
                            maxLength={30}
                        />
                        <input
                            className="input"
                            type="password"
                            value={pw}
                            onChange={(e) => setPw(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && name.trim() && join()}
                            placeholder="Room password (if it has one)"
                        />
                        <button className="btn" disabled={!name.trim()} onClick={join}>Join room</button>
                    </div>
                    {error && <p className="error">{error}</p>}
                </div>
            </main>
        );
    }

    const actuallyPlaying = progress.ps === 1 || progress.ps === 3; // playing or buffering
    const showTap = !!current && state.playing && !actuallyPlaying;

    /* ----- main room ----- */
    return (
        <div className="room">
            <header className="topbar">
                <div className="brand gradient-text">🎧 Listen Together</div>
                <button className="btn-ghost" onClick={copyLink}>
                    {copied ? '✓ Link copied' : '🔗 Copy invite link'}
                </button>
            </header>

            <div className="layout">
                {/* Player */}
                <section className="card player-card">
                    <div className="video-wrap" ref={wrapRef}>
                        {/* Wrapper keeps React away from the element YouTube replaces */}
                        <div><div id="yt-player" /></div>

                        {!native && !actuallyPlaying && (
                            <div className="video-cover">
                                {current ? (
                                    <img src={`https://i.ytimg.com/vi/${current.videoId}/hqdefault.jpg`} alt="" />
                                ) : (
                                    <div className="video-empty">Nothing playing yet. Add a song from the queue panel.</div>
                                )}
                                {showTap && (
                                    <button
                                        className="tap-btn"
                                        onClick={() => {
                                            player.current?.seekTo(state.position, true);
                                            player.current?.playVideo();
                                        }}
                                    >
                                        Tap to start audio
                                    </button>
                                )}
                            </div>
                        )}

                        {!native && <div className="video-shield" />}
                    </div>

                    <div className="now-playing">
                        <div className="now-label">Now playing</div>
                        <div className="now-title">{current ? current.title : '—'}</div>
                    </div>

                    <div className="progress">
                        <span className="time">{fmt(scrub ?? progress.t)}</span>
                        <input
                            className="seek"
                            type="range"
                            min={0}
                            max={progress.d || 0}
                            step={0.1}
                            value={Number(scrub ?? progress.t) || 0}
                            disabled={!current || !progress.d}
                            style={{ '--pct': `${progress.d ? ((scrub ?? progress.t) / progress.d) * 100 : 0}%` }}
                            onChange={(e) => {
                                const pos = Number(e.target.value);
                                setScrub(pos);
                                seekHold.current = Date.now() + 1500;
                                const now = Date.now();
                                if (now - lastLocalSeek.current > 100) {
                                    lastLocalSeek.current = now;
                                    player.current?.seekTo(pos, false);
                                }
                            }}
                            onPointerUp={commitSeek}
                            onKeyUp={commitSeek}
                            onTouchEnd={commitSeek}
                        />
                        <span className="time">{fmt(progress.d)}</span>
                    </div>

                    <div className="controls">
                        <button className="icon-btn" title="Previous" onClick={() => send('prev')}>
                            <Icon d={PREV} />
                        </button>
                        <button className="icon-btn" title="Back 10 seconds" onClick={() => send('skip', { delta: -10 })}>
                            <Icon d={BACK} /><span className="sec">10</span>
                        </button>
                        <button
                            className="play-btn"
                            title={state.playing ? 'Pause' : 'Play'}
                            onClick={() => send(state.playing ? 'pause' : 'play')}
                        >
                            <Icon d={state.playing ? PAUSE : PLAY} />
                        </button>
                        <button className="icon-btn" title="Forward 10 seconds" onClick={() => send('skip', { delta: 10 })}>
                            <Icon d={FWD} /><span className="sec">10</span>
                        </button>
                        <button className="icon-btn" title="Next" onClick={() => send('next')}>
                            <Icon d={NEXT} />
                        </button>
                    </div>

                    <div className="extras">
                        <button className="btn-ghost" onClick={goFullscreen}>⛶ Fullscreen</button>
                        <button className="btn-ghost" onClick={() => setNative((n) => !n)}>
                            {native ? 'Hide YouTube controls' : 'Show YouTube controls (quality, speed)'}
                        </button>
                    </div>
                </section>

                {/* Side column */}
                <aside className="side">
                    <section className="card panel">
                        <h3>Listening now <span>{members.length}</span></h3>
                        <div className="members">
                            {members.map((m, i) => (
                                <div className="member" key={i}>
                                    <span className="avatar" style={{ background: colorFor(m.name) }}>
                                        {m.name.charAt(0).toUpperCase()}
                                    </span>
                                    {m.name}
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="card panel">
                        <h3>Queue <span>{state.queue.length} {state.queue.length === 1 ? 'song' : 'songs'}</span></h3>

                        <div className="add-row">
                            <input
                                className="input"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addSong()}
                                placeholder="Paste a YouTube link"
                            />
                            <button className="btn" onClick={addSong}>Add</button>
                        </div>
                        {error && <p className="error">{error}</p>}

                        {state.queue.length === 0 ? (
                            <p className="empty">The queue is empty.</p>
                        ) : (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                                <SortableContext items={state.queue.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                                    <ul className="queue">
                                        {state.queue.map((song, i) => (
                                            <SortableSong
                                                key={song.id}
                                                song={song}
                                                isCurrent={i === state.index}
                                                onSelect={() => send('select', { itemId: song.id })}
                                                onRemove={() => send('remove', { itemId: song.id })}
                                            />
                                        ))}
                                    </ul>
                                </SortableContext>
                            </DndContext>
                        )}
                    </section>
                </aside>
            </div>
        </div>
    );
}