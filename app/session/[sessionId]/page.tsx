"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import CandidateInfoModal from "@/components/CandidateInfoModal";
import InterviewInterface from "@/components/InterviewInterface";

interface InterviewConfig {
  description: string;
  questions: string[];
  totalDurationSeconds: number;
}

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const [candidateInfo, setCandidateInfo] = useState<{
    name: string;
    email: string;
  } | null>(null);
  const [interviewConfig, setInterviewConfig] =
    useState<InterviewConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch interview configuration
    const fetchConfig = async () => {
      try {
        const response = await fetch(`/api/interview/${sessionId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch interview configuration");
        }
        const data = await response.json();
        setInterviewConfig(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchConfig();
    }
  }, [sessionId]);

  const handleCandidateInfoSubmit = (name: string, email: string) => {
    setCandidateInfo({ name, email });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-xl font-semibold">Loading interview...</div>
          <div className="text-gray-600 dark:text-gray-400">
            Please wait while we prepare your session.
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-xl font-semibold text-red-600">
            Error loading interview
          </div>
          <div className="text-gray-600 dark:text-gray-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!interviewConfig) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {!candidateInfo ? (
        <CandidateInfoModal onSubmit={handleCandidateInfoSubmit} />
      ) : (
        <InterviewInterface
          sessionId={sessionId}
          candidateInfo={candidateInfo}
          interviewConfig={interviewConfig}
        />
      )}
    </div>
  );
}
