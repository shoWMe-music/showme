import AppLayout from "@/components/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";

export function EventManagerSkeleton() {
  return (
    <AppLayout>
      <div className="animate-fade-in space-y-6">
        <Skeleton className="h-4 w-28" />
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-72" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-96" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-36" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-9" />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-1">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1 gap-1">
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-2.5 w-12" />
                </div>
                {i < 4 && <Skeleton className="h-0.5 flex-1 -mt-4" />}
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-1 border-b pb-0">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-none rounded-t" />
          ))}
        </div>
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-5">
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-2 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-5">
            <Skeleton className="h-5 w-28" />
            <div className="grid grid-cols-2 gap-5">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
