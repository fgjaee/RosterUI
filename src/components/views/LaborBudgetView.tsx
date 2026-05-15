import { useState } from 'react';
import type { Target, SummaryRow } from '../../types';
import { formatHours } from '../../lib/helpers';
import { Card, CardContent, AppButton, AppInput } from '../ui';

interface LaborBudgetViewProps {
  targets: Target[];
  summary: SummaryRow[];
  weeklyHoursAvailable: string;
  minimumShiftLength: string;
  autoDeductLunch: boolean;
  department: string;
  totals: { available: number; scheduled: number; difference: number; overage: number; coreScheduled: number; excludedScheduled: number; fullTime: number; partTime: number };
  onWeeklyHoursChange?: (v: string) => void;
  onMinShiftChange?: (v: string) => void;
  onAutoDeductChange?: (v: boolean) => void;
}

export function LaborBudgetView({
  targets, summary, weeklyHoursAvailable, minimumShiftLength, autoDeductLunch, department, totals,
  onWeeklyHoursChange, onMinShiftChange, onAutoDeductChange
}: LaborBudgetViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const budget = parseFloat(weeklyHoursAvailable) || 0;
  const isOver = totals.scheduled > budget;

  const handleToggleEdit = () => {
    setIsEditing(!isEditing);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">Labor Budget</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">Budget configuration and weekly allocation overview for {department}.</p>
        </div>
        <AppButton 
          variant={isEditing ? "tonal" : "ghost"}
          onClick={handleToggleEdit}
          className="rounded-xl"
        >
          <span className="material-symbols-outlined text-[20px] mr-2">
            {isEditing ? 'check' : 'edit_note'}
          </span>
          {isEditing ? 'Finish Editing' : 'Edit Budget'}
        </AppButton>
      </div>

      {/* Config summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className={`${isEditing ? 'ring-2 ring-primary/20' : ''} transition-all`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-on-surface-variant mb-2">
              <span className="material-symbols-outlined text-[18px]">schedule</span>
              <span className="text-label-bold uppercase">Weekly Budget (Hours)</span>
            </div>
            {isEditing ? (
              <AppInput
                type="number"
                value={weeklyHoursAvailable}
                onChange={(e) => onWeeklyHoursChange?.(e.target.value)}
                className="font-headline-md text-headline-md font-bold h-12"
              />
            ) : (
              <div className="font-headline-md text-headline-md font-bold text-on-surface">{weeklyHoursAvailable}h</div>
            )}
          </CardContent>
        </Card>

        <Card className={`${isEditing ? 'ring-2 ring-primary/20' : ''} transition-all`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-on-surface-variant mb-2">
              <span className="material-symbols-outlined text-[18px]">timer</span>
              <span className="text-label-bold uppercase">Min Shift Length</span>
            </div>
            {isEditing ? (
              <AppInput
                type="number"
                value={minimumShiftLength}
                onChange={(e) => onMinShiftChange?.(e.target.value)}
                className="font-headline-md text-headline-md font-bold h-12"
              />
            ) : (
              <div className="font-headline-md text-headline-md font-bold text-on-surface">{minimumShiftLength}h</div>
            )}
          </CardContent>
        </Card>

        <Card className={`${isEditing ? 'ring-2 ring-primary/20' : ''} transition-all`}>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-on-surface-variant mb-2">
              <span className="material-symbols-outlined text-[18px]">lunch_dining</span>
              <span className="text-label-bold uppercase">Auto Lunch Deduct</span>
            </div>
            <div className="flex items-center gap-3">
              {isEditing ? (
                <button
                  onClick={() => onAutoDeductChange?.(!autoDeductLunch)}
                  className={`flex-1 h-12 rounded-lg font-bold flex items-center justify-center transition-all ${
                    autoDeductLunch 
                      ? 'bg-primary text-on-primary' 
                      : 'bg-surface-container-high text-on-surface-variant'
                  }`}
                >
                  {autoDeductLunch ? 'ENABLED (−0.5h)' : 'DISABLED'}
                </button>
              ) : (
                <div className="font-headline-md text-headline-md font-bold text-on-surface">
                  {autoDeductLunch ? 'Enabled' : 'Disabled'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Budget health */}
      <Card className="border-none shadow-lg bg-surface-container-low overflow-hidden">
        <div className={`h-1.5 w-full ${isOver ? 'bg-error' : 'bg-status-opener-text'}`} />
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-headline-md text-headline-md text-on-surface">Budget Health</h2>
            <div className={`px-4 py-1.5 rounded-full text-label-bold flex items-center gap-2 ${isOver ? 'bg-error-container text-on-error-container' : 'bg-status-opener-bg text-status-opener-text'}`}>
              <span className="material-symbols-outlined text-[18px]">
                {isOver ? 'warning' : 'check_circle'}
              </span>
              {isOver ? `+${formatHours(totals.overage)}h OVER` : `-${formatHours(totals.difference)}h UNDER`}
            </div>
          </div>
          <p className="text-body-md text-on-surface-variant mb-6">
            {isOver
              ? `Your current schedule exceeds the budget by ${formatHours(totals.overage)} hours. Consider reducing part-time shifts or adjusting target coverage.`
              : `You are currently ${formatHours(totals.difference)} hours under budget. You have room for additional staffing if needed.`}
          </p>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 bg-surface-container-lowest rounded-2xl border border-outline-variant/30">
            {[
              { label: 'Total Budget', value: formatHours(totals.available), color: 'text-primary' },
              { label: 'Scheduled', value: formatHours(totals.scheduled), color: isOver ? 'text-error' : 'text-status-opener-text' },
              { label: 'FT Allocated', value: formatHours(totals.fullTime), color: 'text-on-surface' },
              { label: 'PT Remaining', value: formatHours(totals.partTime), color: 'text-on-surface' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex flex-col gap-1">
                <div className="text-label-sm text-on-surface-variant uppercase tracking-widest">{label}</div>
                <div className={`text-headline-md font-black font-data-tabular tabular-nums ${color}`}>{value}<span className="text-body-sm font-normal ml-0.5">h</span></div>
              </div>
            ))}
          </div>

          <div className="mt-8 relative h-4 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out ${isOver ? 'bg-error' : 'bg-status-opener-text'}`}
              style={{ width: `${Math.min(100, (totals.scheduled / (totals.available || 1)) * 100)}%` }}
            />
            {budget > 0 && (
              <div 
                className="absolute inset-y-0 w-0.5 bg-on-surface/20 z-10" 
                style={{ left: `${(totals.scheduled / (totals.available || 1)) * 100}%` }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Daily hours breakdown */}
      <Card className="overflow-hidden border-outline-variant/40">
        <CardContent className="p-0">
          <div className="p-5 border-b border-outline-variant/30 bg-surface-container-low/50">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">Daily Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-container-highest/30">
                  <th className="p-4 text-left text-label-bold uppercase text-on-surface-variant border-b border-outline-variant/30">Day</th>
                  <th className="p-4 text-left text-label-bold uppercase text-on-surface-variant border-b border-outline-variant/30">Date</th>
                  <th className="p-4 text-center text-label-bold uppercase text-on-surface-variant border-b border-outline-variant/30">Openers</th>
                  <th className="p-4 text-center text-label-bold uppercase text-on-surface-variant border-b border-outline-variant/30">Closers</th>
                  <th className="p-4 text-center text-label-bold uppercase text-on-surface-variant border-b border-outline-variant/30">Overnight</th>
                  <th className="p-4 text-right text-label-bold uppercase text-on-surface-variant border-b border-outline-variant/30">Sched Hrs</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((day, i) => (
                  <tr key={day.day} className={`border-b border-outline-variant/20 hover:bg-surface-container-low transition-colors ${i % 2 === 0 ? '' : 'bg-surface-container-lowest/50'}`}>
                    <td className="p-4 font-bold text-on-surface">{day.day}</td>
                    <td className="p-4 font-data-tabular tabular-nums text-on-surface-variant">{targets[i]?.date ?? '—'}</td>
                    <td className="p-4 text-center">
                      <div className="flex flex-col">
                        <span className="font-data-tabular tabular-nums font-bold text-on-surface">{day.open}</span>
                        <span className="text-[10px] text-on-surface-variant">Tgt: {targets[i]?.openNeeded}</span>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex flex-col">
                        <span className="font-data-tabular tabular-nums font-bold text-on-surface">{day.close}</span>
                        <span className="text-[10px] text-on-surface-variant">Tgt: {targets[i]?.closeNeeded}</span>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex flex-col">
                        <span className="font-data-tabular tabular-nums font-bold text-on-surface">{day.overnight}</span>
                        <span className="text-[10px] text-on-surface-variant">Tgt: {targets[i]?.overnightNeeded}</span>
                      </div>
                    </td>
                    <td className="p-4 text-right font-data-tabular tabular-nums font-black text-on-surface">{formatHours(day.scheduledHours)}h</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-container-low font-bold">
                  <td className="p-4 text-on-surface" colSpan={5}>Total Weekly Hours</td>
                  <td className="p-4 text-right text-primary font-black text-lg">{formatHours(totals.scheduled)}h</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
