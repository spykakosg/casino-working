"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4000/api/crash/ws";

export function useCrash(token) {
  const ws      = useRef(null);
  const tickRef = useRef(null);

  const [gameState, setGameState]           = useState("waiting");
  const [multiplier, setMultiplier]         = useState(1.00);
  const [crashPoint, setCrashPoint]         = useState(null);
  const [startedAt, setStartedAt]           = useState(null);
  const [waitingStartedAt, setWaitingStartedAt] = useState(null);
  const [waitingDuration, setWaitingDuration]   = useState(5000);
  const [history, setHistory]               = useState([]);
  const [activeBets, setActiveBets]         = useState([]);
  const [roundId, setRoundId]               = useState(null);
  const [myBet, setMyBet]                   = useState(null);   // current round
  const [myQueuedBet, setMyQueuedBet]       = useState(null);   // queued for next
  const [error, setError]                   = useState("");
  const [connected, setConnected]           = useState(false);
  const myUsernameRef                       = useRef(null);

  // Countdown: ms remaining in waiting phase
  const [countdown, setCountdown]           = useState(0);
  const countdownRef                        = useRef(null);

  function startTicker(sAt) {
    stopTicker();
    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - sAt;
      const t = elapsed / 1000;
      const m = Math.pow(Math.E, 0.06 * t);
      setMultiplier(parseFloat(Math.max(1.00, m).toFixed(2)));
    }, 50);
  }

  function stopTicker() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }

  function startCountdown(wStartedAt, wDuration) {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      const remaining = wDuration - (Date.now() - wStartedAt);
      setCountdown(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }, 50);
  }

  function stopCountdown() {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(0);
  }

  useEffect(() => {
    if (!token) return;

    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onopen = () => {
      setConnected(true);
      socket.send(JSON.stringify({ type: "auth", token }));
    };

    socket.onclose = () => {
      setConnected(false);
      stopTicker();
      stopCountdown();
    };

    socket.onerror = () => {};

    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);

      if (msg.type === "auth_ok") {
        myUsernameRef.current = msg.username;
      }

      if (msg.type === "init") {
        setGameState(msg.state);
        setRoundId(msg.roundId);
        setHistory(msg.history || []);
        setActiveBets(msg.activeBets || []);
        if (msg.state === "running" && msg.startedAt) {
          setStartedAt(msg.startedAt);
          startTicker(msg.startedAt);
        }
        if (msg.state === "waiting" && msg.waitingStartedAt) {
          setWaitingStartedAt(msg.waitingStartedAt);
          setWaitingDuration(msg.waitingDuration || 5000);
          startCountdown(msg.waitingStartedAt, msg.waitingDuration || 5000);
        }
      }

      if (msg.type === "waiting") {
        setGameState("waiting");
        setMultiplier(1.00);
        setCrashPoint(null);
        setStartedAt(null);
        setActiveBets([]);
        setMyBet(null);
        setRoundId(msg.roundId);
        setWaitingStartedAt(msg.waitingStartedAt);
        setWaitingDuration(msg.duration || 5000);
        setHistory(msg.history || []);
        setError("");
        stopTicker();
        startCountdown(msg.waitingStartedAt, msg.duration || 5000);
        // Queued bet becomes active bet for new round
        setMyQueuedBet(null);
      }

      if (msg.type === "running") {
        setGameState("running");
        setStartedAt(msg.startedAt);
        startTicker(msg.startedAt);
        stopCountdown();
      }

      if (msg.type === "crashed") {
        setGameState("crashed");
        setCrashPoint(msg.crashPoint);
        setMultiplier(msg.crashPoint);
        stopTicker();
        stopCountdown();
        // If we had a bet and didn't cash out, mark it lost
        setMyBet(prev => prev && !prev.cashedOut ? { ...prev, lost: true } : prev);
      }

      if (msg.type === "player_bet") {
        setActiveBets(prev => [...prev, {
          username: msg.username, betAmount: msg.betAmount,
          currency: msg.currency, cashedOut: false,
        }]);
      }

      if (msg.type === "player_cashout") {
        setActiveBets(prev => prev.map(b =>
          b.username === msg.username
            ? { ...b, cashedOut: true, payout: msg.payout, cashoutAt: msg.multiplier }
            : b
        ));
        // Update myBet when auto cashout fires for us
        if (msg.username === myUsernameRef.current) {
          setMyBet(prev => prev && !prev.cashedOut
            ? { ...prev, cashedOut: true, payout: msg.payout, cashoutAt: msg.multiplier }
            : prev
          );
        }
      }

      if (msg.type === "bet_accepted") {
        if (msg.queued) {
          setMyQueuedBet({ betAmount: msg.betAmount, currency: msg.currency });
        } else {
          setMyBet({ betAmount: msg.betAmount, currency: msg.currency, cashedOut: false });
        }
        setError("");
      }

      if (msg.type === "queued_bet_placed") {
        // Our queued bet just auto-placed for the new round
        setMyBet({ betAmount: msg.betAmount, currency: msg.currency, cashedOut: false });
        setMyQueuedBet(null);
      }

      if (msg.type === "cashout_accepted") {
        setMyBet(prev => ({ ...prev, cashedOut: true, payout: msg.payout, cashoutAt: msg.multiplier }));
      }

      if (msg.type === "error") {
        setError(msg.message);
      }
    };

    return () => {
      stopTicker();
      stopCountdown();
      socket.close();
    };
  }, [token]);

  const placeBet = useCallback((betAmount, currency, autoCashout) => {
    if (!ws.current || ws.current.readyState !== 1) { setError("Not connected"); return; }
    setError("");
    ws.current.send(JSON.stringify({
      type: "bet", betAmount, currency,
      autoCashout: autoCashout || null,
    }));
  }, []);

  const cashOut = useCallback(() => {
    if (!ws.current || ws.current.readyState !== 1) return;
    ws.current.send(JSON.stringify({ type: "cashout" }));
  }, []);

  return {
    gameState, multiplier, crashPoint, history,
    activeBets, myBet, myQueuedBet,
    countdown, waitingDuration,
    roundId, error, connected,
    placeBet, cashOut,
  };
}
