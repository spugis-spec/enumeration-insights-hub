import type { FeederReportRow } from '@/lib/weekly/types';

interface SummaryCardsProps {
  data: FeederReportRow[];
  showTitle?: boolean;
  titlePrefix?: string;
}

export function SummaryCards({ data }: SummaryCardsProps) {
  const totalWeek = {
    mappedDT: data.reduce((sum, r) => sum + r.mappedDTWeek, 0),
    htPoles: data.reduce((sum, r) => sum + r.htPolesWeek, 0),
    ltPoles: data.reduce((sum, r) => sum + r.ltPolesWeek, 0),
    consumerPoints: data.reduce((sum, r) => sum + r.consumerPointsWeek, 0),
    issueLog: data.reduce((sum, r) => sum + r.issueLogWeek, 0),
  };

  const totalAll = {
    mappedDT: data.reduce((sum, r) => sum + r.mappedDTTotal, 0),
    htPoles: data.reduce((sum, r) => sum + r.htPolesTotal, 0),
    ltPoles: data.reduce((sum, r) => sum + r.ltPolesTotal, 0),
    consumerPoints: data.reduce((sum, r) => sum + r.consumerPointsTotal, 0),
    issueLog: data.reduce((sum, r) => sum + r.issueLogTotal, 0),
  };

  const cards = [
    {
      title: 'Mapped DT by GIS',
      weekValue: totalWeek.mappedDT,
      totalValue: totalAll.mappedDT,
      color: 'from-blue-500 to-blue-600',
      bgColor: 'bg-blue-50',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      ),
    },
    {
      title: 'HT Poles',
      weekValue: totalWeek.htPoles,
      totalValue: totalAll.htPoles,
      color: 'from-green-500 to-green-600',
      bgColor: 'bg-green-50',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      title: 'LT Poles',
      weekValue: totalWeek.ltPoles,
      totalValue: totalAll.ltPoles,
      color: 'from-orange-500 to-orange-600',
      bgColor: 'bg-orange-50',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
    },
    {
      title: 'Consumer Points',
      weekValue: totalWeek.consumerPoints,
      totalValue: totalAll.consumerPoints,
      color: 'from-pink-500 to-pink-600',
      bgColor: 'bg-pink-50',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      title: 'Issue Log',
      weekValue: totalWeek.issueLog,
      totalValue: totalAll.issueLog,
      color: 'from-red-500 to-red-600',
      bgColor: 'bg-red-50',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {cards.map((card) => (
        <div
          key={card.title}
          className={`${card.bgColor} rounded-xl p-4 border border-gray-200 shadow-sm`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className={`p-2 rounded-lg bg-gradient-to-br ${card.color} text-white`}>
              {card.icon}
            </div>
          </div>
          <h3 className="text-sm font-medium text-gray-600 mb-1">{card.title}</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{card.weekValue}</span>
            <span className="text-sm text-gray-500">this week</span>
          </div>
          <div className="text-sm text-gray-500 mt-1">
            Total: <span className="font-semibold text-gray-700">{card.totalValue}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
