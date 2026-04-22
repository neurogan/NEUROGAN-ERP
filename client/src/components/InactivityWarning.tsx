import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLogout } from "@/lib/auth";

const IDLE_WARN_MS = 14 * 60 * 1000;  // 14 min — show warning
const IDLE_LOGOUT_MS = 15 * 60 * 1000; // 15 min — auto-logout

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];

interface Props {
  isAuthenticated: boolean;
}

export function InactivityWarning({ isAuthenticated }: Props) {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const lastActivityRef = useRef(Date.now());
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logout = useLogout();
  const [, navigate] = useLocation();

  const clearTimers = () => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
  };

  const doLogout = () => {
    clearTimers();
    setShowWarning(false);
    void logout.mutateAsync().finally(() => navigate("/login"));
  };

  const resetTimers = () => {
    clearTimers();
    lastActivityRef.current = Date.now();

    warnTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setCountdown(60);
      countdownIntervalRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            doLogout();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      logoutTimerRef.current = setTimeout(doLogout, IDLE_LOGOUT_MS - IDLE_WARN_MS);
    }, IDLE_WARN_MS);
  };

  useEffect(() => {
    if (!isAuthenticated) {
      clearTimers();
      setShowWarning(false);
      return;
    }

    resetTimers();

    const onActivity = () => {
      if (!showWarning) resetTimers();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }

    return () => {
      clearTimers();
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
    };
  }, [isAuthenticated]);

  const handleStayLoggedIn = () => {
    setShowWarning(false);
    resetTimers();
  };

  return (
    <AlertDialog open={showWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Session expiring soon</AlertDialogTitle>
          <AlertDialogDescription>
            You will be automatically signed out due to inactivity in{" "}
            <span className="font-semibold tabular-nums">{countdown}</span> second
            {countdown !== 1 ? "s" : ""}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={doLogout}>Sign out now</AlertDialogCancel>
          <AlertDialogAction onClick={handleStayLoggedIn}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
