import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Play, Pause, SkipForward, Scissors, X, ChevronDown } from 'lucide-react';
import styles from './ReplayControls.module.css';

const ReplayControls = ({
    isPlaying,
    speed,
    onPlayPause,
    onForward,
    onJumpTo,
    onSpeedChange,
    onClose
}) => {
    const speeds = [0.1, 0.5, 1, 3, 5, 10];
    const [showSpeedMenu, setShowSpeedMenu] = React.useState(false);

    // ── Drag state ────────────────────────────────────────────────────────
    const containerRef = useRef(null);
    const dragRef = useRef(null);
    // position: offset from initial bottom-center anchor; null = use CSS default
    const [pos, setPos] = useState(null);

    const onDragStart = useCallback((e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        dragRef.current = {
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startLeft:   rect.left,
            startTop:    rect.top,
        };

        const onMove = (ev) => {
            if (!dragRef.current) return;
            const dx = ev.clientX - dragRef.current.startMouseX;
            const dy = ev.clientY - dragRef.current.startMouseY;
            const newLeft = dragRef.current.startLeft + dx;
            const newTop  = dragRef.current.startTop  + dy;
            setPos({ left: newLeft, top: newTop });
        };

        const onUp = () => {
            dragRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, []);

    // Reset position if component remounts (e.g. replay restarted)
    useEffect(() => { setPos(null); }, []);

    const style = pos
        ? { position: 'fixed', left: pos.left, top: pos.top, transform: 'none', bottom: 'auto' }
        : {};

    return (
        <div className={styles.container} ref={containerRef} style={style}>
            <div
                className={styles.dragHandle}
                onMouseDown={onDragStart}
                title="Drag to move"
            >
                <div className={styles.title}>Replay mode</div>
            </div>

            <div className={styles.controls}>
                <button
                    className={styles.button}
                    onClick={onJumpTo}
                    title="Jump to..."
                >
                    <Scissors size={20} />
                </button>

                <div className={styles.separator} />

                <button
                    className={styles.button}
                    onClick={onPlayPause}
                    title={isPlaying ? "Pause" : "Play"}
                >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>

                <button
                    className={styles.button}
                    onClick={onForward}
                    title="Forward"
                >
                    <SkipForward size={20} />
                </button>

                <div className={styles.speedWrapper}>
                    <button
                        className={`${styles.button} ${styles.speedButton}`}
                        onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                        title="Replay speed"
                    >
                        <span>{speed}x</span>
                        <ChevronDown size={14} />
                    </button>

                    {showSpeedMenu && (
                        <div className={styles.speedMenu}>
                            {speeds.map(s => (
                                <div
                                    key={s}
                                    className={`${styles.speedItem} ${speed === s ? styles.activeSpeed : ''}`}
                                    onClick={() => {
                                        onSpeedChange(s);
                                        setShowSpeedMenu(false);
                                    }}
                                >
                                    {s}x
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className={styles.separator} />

                <button
                    className={`${styles.button} ${styles.closeButton}`}
                    onClick={onClose}
                    title="Exit Replay mode"
                >
                    <X size={20} />
                </button>
            </div>
        </div>
    );
};

export default ReplayControls;
