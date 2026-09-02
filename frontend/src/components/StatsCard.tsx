import { useTheme } from "../context/ThemeContext";

type StatsCardProps = {
  icon: string;
  title: string;
  value: string;
  description: string;
};

function StatsCard({
  icon,
  title,
  value,
  description,
}: StatsCardProps) {
  const { theme } = useTheme();

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border p-5 backdrop-blur-2xl transition-all duration-300 ease-out hover:-translate-y-1.5 ${
        theme === "dark"
          ? "border-white/15 bg-white/[0.04] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] hover:border-cyan-400/50 hover:bg-white/[0.07] hover:shadow-[0_20px_40px_rgba(6,182,212,0.2)]"
          : "border-white/80 bg-white/45 shadow-[0_15px_30px_-8px_rgba(0,0,0,0.05)] hover:border-blue-300/80 hover:bg-white/70 hover:shadow-[0_20px_35px_-5px_rgba(37,99,235,0.12)]"
      }`}
    >
      {/* Top highlight specular reflection line */}
      <div
        className={`absolute inset-x-0 top-0 h-[1px] transition-opacity ${
          theme === "dark"
            ? "bg-gradient-to-r from-transparent via-white/30 to-transparent group-hover:via-cyan-400/60"
            : "bg-gradient-to-r from-transparent via-blue-300/50 to-transparent group-hover:via-blue-400"
        }`}
      />

      {/* Background aura glow */}
      <div
        className={`absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl transition-all duration-500 pointer-events-none ${
          theme === "dark"
            ? "bg-cyan-500/0 group-hover:bg-cyan-500/15"
            : "bg-blue-500/0 group-hover:bg-blue-500/15"
        }`}
      />

      {/* Top Section */}
      <div className="relative z-10 flex items-center justify-between gap-3">

        {/* Icon */}
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg shadow-inner transition-all duration-300 ${
            theme === "dark"
              ? "border-cyan-400/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.2)] group-hover:scale-105 group-hover:border-cyan-400/50 group-hover:bg-cyan-500/25"
              : "border-blue-200/80 bg-blue-50 text-blue-600 shadow-sm group-hover:scale-105 group-hover:bg-blue-100"
          }`}
        >
          {icon}
        </div>

        {/* Period */}
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
            theme === "dark"
              ? "border-white/10 bg-white/5 text-zinc-400"
              : "border-slate-200 bg-slate-100 text-slate-500"
          }`}
        >
          This week
        </span>

      </div>


      {/* Content */}
      <div className="relative z-10 mt-4 sm:mt-5">

        {/* Title */}
        <h3 className={`text-sm font-semibold tracking-wide ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
          {title}
        </h3>

        {/* Value */}
        <p className={`mt-1 text-2xl font-black tracking-tight sm:text-3xl ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
          {value}
        </p>

        {/* Description */}
        <p className={`mt-1 text-xs leading-5 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
          {description}
        </p>

      </div>
    </div>
  );
}

export default StatsCard;