"use client";

interface ThankYouModalProps {
  isOpen: boolean;
  candidateName: string;
}

export default function ThankYouModal({
  isOpen,
  candidateName,
}: ThankYouModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-xl dark:bg-gray-800">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <svg
                className="h-8 w-8 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          </div>
          <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
            Thank You!
          </h2>
          <p className="mb-6 text-gray-600 dark:text-gray-400">
            Thank you, <span className="font-semibold">{candidateName}</span>,
            for submitting your video application. We have successfully received
            your interview recording.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Our team will review your submission and get back to you soon.
          </p>
        </div>
      </div>
    </div>
  );
}
