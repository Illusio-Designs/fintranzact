import type { EndpointParam } from "@/content/developers/types";
import { BlockLabel, RichText } from "./ui";

/**
 * Input parameters: a table on wider screens, stacked rows on phones so
 * nothing scrolls sideways.
 */
export function ParamTable({ params, title = "Parameters" }: { params: EndpointParam[]; title?: string }) {
  if (params.length === 0) return null;

  return (
    <div className="mt-8">
      <BlockLabel>{title}</BlockLabel>

      {/* Wide screens: the classic four-column table */}
      <div className="mt-3 hidden overflow-hidden rounded-xl border border-border-light md:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-surface-1 text-xs font-semibold text-text-tertiary">
            <tr>
              <th className="w-[30%] px-4 py-2.5">Name</th>
              <th className="w-[22%] px-4 py-2.5">Type</th>
              <th className="w-[13%] px-4 py-2.5">Required</th>
              <th className="px-4 py-2.5">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {params.map((param) => (
              <tr key={param.name} className="align-top">
                <td className="px-4 py-3">
                  <ParamName param={param} />
                </td>
                <td className="px-4 py-3">
                  <ParamType type={param.type} />
                </td>
                <td className="px-4 py-3">
                  <Required required={param.required} />
                </td>
                <td className="px-4 py-3">
                  <ParamDescription param={param} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones and small tablets: one block per parameter */}
      <ul className="mt-3 divide-y divide-border-light rounded-xl border border-border-light md:hidden">
        {params.map((param) => (
          <li key={param.name} className="px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <ParamName param={param} />
              <ParamType type={param.type} />
              <Required required={param.required} />
            </div>
            <div className="mt-2">
              <ParamDescription param={param} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ParamName({ param }: { param: EndpointParam }) {
  return (
    <div className="min-w-0">
      <code className="font-mono text-[13px] font-semibold text-[#0f1b3d] [overflow-wrap:anywhere] dark:text-cyan-200">
        {param.name}
      </code>
      {param.default !== undefined && (
        <div className="mt-1 text-[11px] text-text-tertiary">
          default: <code className="font-mono">{String(param.default)}</code>
        </div>
      )}
    </div>
  );
}

function ParamType({ type }: { type: string }) {
  return (
    <code className="font-mono text-xs text-emerald-700 [overflow-wrap:anywhere] dark:text-emerald-300">{type}</code>
  );
}

function Required({ required }: { required: boolean }) {
  return required ? (
    <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">required</span>
  ) : (
    <span className="text-[11px] text-text-tertiary">optional</span>
  );
}

function ParamDescription({ param }: { param: EndpointParam }) {
  return (
    <>
      <p className="text-sm leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
        <RichText text={param.description} />
      </p>
      {param.enumValues && param.enumValues.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {param.enumValues.map((v) => (
            <code
              key={v}
              className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 font-mono text-[11px] text-purple-700 dark:border-purple-400/20 dark:bg-purple-400/10 dark:text-purple-200"
            >
              {v}
            </code>
          ))}
        </div>
      )}
    </>
  );
}
