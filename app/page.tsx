import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <main className="flex min-h-screen w-full max-w-4xl flex-col items-center justify-center py-16 px-8">
        <div className="w-full max-w-2xl space-y-8 text-center">
          <div className="space-y-4">
            <h1 className="text-5xl font-bold text-gray-900 dark:text-white">
              Asynchronous Video Interviews
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300">
              Record your responses at your own pace
            </p>
          </div>

          <div className="rounded-lg bg-white p-8 shadow-lg dark:bg-gray-800">
            <div className="space-y-6 text-left">
              <div>
                <h2 className="mb-3 text-2xl font-semibold text-gray-900 dark:text-white">
                  How It Works
                </h2>
                <div className="space-y-4 text-gray-700 dark:text-gray-300">
                  <p>
                    Our asynchronous interview process allows you to record your responses
                    to interview questions at your convenience. Here's what to expect:
                  </p>
                  <ul className="list-disc space-y-2 pl-6">
                    <li>
                      You'll answer multiple questions sequentially in a single continuous
                      recording
                    </li>
                    <li>
                      Each question will be displayed one at a time, and you can take your
                      time to think before answering
                    </li>
                    <li>
                      You'll have a total time limit for the entire interview session
                    </li>
                    <li>
                      Your video will be recorded and uploaded in real-time as you speak
                    </li>
                    <li>
                      Make sure you have a working camera and microphone before starting
                    </li>
                  </ul>
                </div>
              </div>

              <div className="rounded-md bg-blue-50 p-4 dark:bg-blue-900/20">
                <p className="text-sm text-blue-900 dark:text-blue-200">
                  <strong>Note:</strong> You'll need to provide your name and email before
                  starting the interview. This information is required and cannot be skipped.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/session/demo"
              className="rounded-lg bg-blue-600 px-8 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              Start Interview
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
