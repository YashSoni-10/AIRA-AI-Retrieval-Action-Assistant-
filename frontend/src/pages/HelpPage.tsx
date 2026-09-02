import { useTheme } from "../context/ThemeContext";

function HelpPage() {
  const { theme } = useTheme();

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">

      {/* Page Header */}
      <div
        className={`border-b px-5 py-5 backdrop-blur-xl transition-colors duration-300 sm:px-8 ${
          theme === "dark"
            ? "border-white/10 bg-[#090b15]/80 text-white"
            : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
              Help & Support
            </h2>

            <p className={`mt-1 text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              Find answers and get help with AIRA
            </p>
          </div>
        </div>
      </div>


      {/* Main Content */}
      <main
        className={`relative flex-1 px-5 py-6 transition-colors duration-300 sm:px-8 sm:py-8 ${
          theme === "dark" ? "bg-[#060812]" : "bg-slate-50"
        }`}
      >

        <div className="mx-auto max-w-6xl">

          {/* Hero */}
          <section
            className={`relative overflow-hidden rounded-2xl border p-6 shadow-2xl backdrop-blur-xl transition-colors duration-300 sm:p-8 ${
              theme === "dark"
                ? "border-white/10 bg-gradient-to-r from-[#10152b] via-[#0b0e1d] to-[#070914]"
                : "border-blue-100 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white"
            }`}
          >
            {theme === "dark" && (
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-cyan-500/0 via-cyan-400/40 via-blue-400/40 to-indigo-500/0" />
            )}

            <div className="relative z-10">

              <div className="flex items-center gap-4">

                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-xl ${
                    theme === "dark"
                      ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
                      : "border-white/30 bg-white/20 text-cyan-200 backdrop-blur-md"
                  }`}
                >
                  ?
                </div>

                <div>
                  <h1 className="text-xl font-extrabold text-white sm:text-2xl">
                    How can we{" "}
                    <span
                      className={
                        theme === "dark"
                          ? "bg-gradient-to-r from-cyan-300 via-blue-300 to-indigo-300 bg-clip-text text-transparent"
                          : "text-cyan-200"
                      }
                    >
                      help you
                    </span>
                    ?
                  </h1>

                  <p className={`mt-1 text-sm ${theme === "dark" ? "text-zinc-400" : "text-blue-100"}`}>
                    Search our help resources or explore common topics.
                  </p>
                </div>

              </div>


              {/* Search */}
              <div
                className={`mt-6 flex items-center gap-3 rounded-xl border p-2.5 shadow-xl backdrop-blur-xl ${
                  theme === "dark"
                    ? "border-white/10 bg-zinc-950/60 focus-within:border-cyan-400/50"
                    : "border-white/30 bg-white/20 text-white focus-within:border-white"
                }`}
              >

                <span className={`pl-2 text-lg ${theme === "dark" ? "text-cyan-400" : "text-cyan-200"}`}>
                  🔍
                </span>

                <input
                  type="text"
                  placeholder="Search for help..."
                  className={`min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none ${
                    theme === "dark" ? "text-white placeholder:text-zinc-500" : "text-white placeholder:text-blue-100"
                  }`}
                />

              </div>

            </div>
          </section>


          {/* Help Topics */}
          <section className="mt-8">

            <div>
              <h2 className="text-lg font-bold text-white">
                Help Topics
              </h2>

              <p className="mt-1 text-sm text-zinc-400">
                Learn how to use different parts of AIRA.
              </p>
            </div>


            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

              {/* Getting Started */}
              <div className={`rounded-2xl border p-5 backdrop-blur-2xl transition-all hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl ${
                theme === "dark" ? "border-white/15 bg-white/[0.04] hover:bg-white/[0.07]" : "border-white/80 bg-white/45 hover:bg-white/70 shadow-md"
              }`}>

                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-lg text-cyan-300">
                  🚀
                </div>

                <h3 className={`mt-4 font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                  Getting Started
                </h3>

                <p className={`mt-2 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Learn the basics of AIRA and set up your workspace.
                </p>

                <button className={`mt-4 text-sm font-semibold ${theme === "dark" ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}>
                  Learn more →
                </button>

              </div>


              {/* AI Assistant */}
              <div className={`rounded-2xl border p-5 backdrop-blur-2xl transition-all hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl ${
                theme === "dark" ? "border-white/15 bg-white/[0.04] hover:bg-white/[0.07]" : "border-white/80 bg-white/45 hover:bg-white/70 shadow-md"
              }`}>

                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-lg text-cyan-300">
                  ✦
                </div>

                <h3 className={`mt-4 font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                  Using AIRA
                </h3>

                <p className={`mt-2 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Learn how to ask questions and get better AI answers.
                </p>

                <button className={`mt-4 text-sm font-semibold ${theme === "dark" ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}>
                  Learn more →
                </button>

              </div>


              {/* Knowledge */}
              <div className={`rounded-2xl border p-5 backdrop-blur-2xl transition-all hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl ${
                theme === "dark" ? "border-white/15 bg-white/[0.04] hover:bg-white/[0.07]" : "border-white/80 bg-white/45 hover:bg-white/70 shadow-md"
              }`}>

                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10 text-lg text-violet-300">
                  📚
                </div>

                <h3 className={`mt-4 font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                  Knowledge Base
                </h3>

                <p className={`mt-2 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Understand knowledge sources, search and AI retrieval.
                </p>

                <button className={`mt-4 text-sm font-semibold ${theme === "dark" ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}>
                  Learn more →
                </button>

              </div>


              {/* Documents */}
              <div className={`rounded-2xl border p-5 backdrop-blur-2xl transition-all hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl ${
                theme === "dark" ? "border-white/15 bg-white/[0.04] hover:bg-white/[0.07]" : "border-white/80 bg-white/45 hover:bg-white/70 shadow-md"
              }`}>

                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/10 text-lg text-emerald-300">
                  📄
                </div>

                <h3 className={`mt-4 font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                  Documents
                </h3>

                <p className={`mt-2 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Upload, manage and search documents in your workspace.
                </p>

                <button className={`mt-4 text-sm font-semibold ${theme === "dark" ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}>
                  Learn more →
                </button>

              </div>


              {/* Agents */}
              <div className={`rounded-2xl border p-5 backdrop-blur-2xl transition-all hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl ${
                theme === "dark" ? "border-white/15 bg-white/[0.04] hover:bg-white/[0.07]" : "border-white/80 bg-white/45 hover:bg-white/70 shadow-md"
              }`}>

                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-lg text-blue-300">
                  ⚡
                </div>

                <h3 className={`mt-4 font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                  AI Agents
                </h3>

                <p className={`mt-2 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Learn how AIRA agents reason and perform tasks.
                </p>

                <button className={`mt-4 text-sm font-semibold ${theme === "dark" ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}>
                  Learn more →
                </button>

              </div>


              {/* Projects */}
              <div className={`rounded-2xl border p-5 backdrop-blur-2xl transition-all hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl ${
                theme === "dark" ? "border-white/15 bg-white/[0.04] hover:bg-white/[0.07]" : "border-white/80 bg-white/45 hover:bg-white/70 shadow-md"
              }`}>

                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-pink-400/20 bg-pink-500/10 text-lg text-pink-300">
                  ◆
                </div>

                <h3 className={`mt-4 font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                  Projects
                </h3>

                <p className={`mt-2 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Organize work, tasks and project-related knowledge.
                </p>

                <button className={`mt-4 text-sm font-semibold ${theme === "dark" ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}>
                  Learn more →
                </button>

              </div>

            </div>

          </section>


          {/* FAQ */}
          <section className={`mt-8 rounded-2xl border p-5 backdrop-blur-2xl shadow-2xl sm:p-6 ${
            theme === "dark" ? "border-white/15 bg-white/[0.04]" : "border-white/80 bg-white/45 shadow-md"
          }`}>

            <h2 className={`text-lg font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
              Frequently Asked Questions
            </h2>

            <div className="mt-5 divide-y divide-white/10">

              <details className="py-4">
                <summary className={`cursor-pointer text-sm font-semibold hover:text-cyan-300 ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
                  What can I ask AIRA?
                </summary>

                <p className={`mt-3 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  You can ask questions about information available
                  in your connected workspace knowledge sources.
                </p>
              </details>


              <details className="py-4">
                <summary className={`cursor-pointer text-sm font-semibold hover:text-cyan-300 ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
                  How does AIRA use my documents?
                </summary>

                <p className={`mt-3 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Documents can be processed and indexed so that
                  relevant information can be retrieved when answering
                  questions.
                </p>
              </details>


              <details className="py-4">
                <summary className={`cursor-pointer text-sm font-semibold hover:text-cyan-300 ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
                  What are AI Agents?
                </summary>

                <p className={`mt-3 text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  AI Agents are specialized assistants designed to
                  perform specific tasks using available tools and
                  knowledge sources.
                </p>
              </details>

            </div>

          </section>


          {/* Contact Support */}
          <section className={`mt-6 rounded-2xl border p-6 backdrop-blur-2xl shadow-2xl ${
            theme === "dark" ? "border-white/15 bg-white/[0.04]" : "border-white/80 bg-white/45 shadow-md"
          }`}>

            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">

              <div>
                <h2 className={`text-lg font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                  Still need help?
                </h2>

                <p className={`mt-1 text-sm ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Contact the support team if you can't find an answer.
                </p>
              </div>

              <button className="rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110">
                Contact Support
              </button>

            </div>

          </section>

        </div>

      </main>
    </div>
  );
}

export default HelpPage;