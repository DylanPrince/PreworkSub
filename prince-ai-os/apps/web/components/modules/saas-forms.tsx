"use client";
import { Select } from "@/components/ui/input";
import {
  addBacklogItemAction,
  createSaasProjectAction,
  setBacklogStatusAction,
  updateSaasProjectAction,
} from "@/lib/module-actions";
import { useFormAction } from "@/lib/use-form-action";
import { useHydrated } from "@/lib/use-hydrated";
import { InputField, SelectField, TextareaField, type FieldErrors } from "./field";
import type { Option } from "./options";
import { RecordForm } from "./record-form";

export interface SaasDefaults {
  name: string;
  summary: string;
  stage: string;
  repositoryUrl: string;
  requirements: string;
}

function ProjectFields({
  f,
  errors,
  businesses,
  stages,
  defaults,
}: {
  f: string;
  errors: FieldErrors;
  businesses?: Option[];
  stages: Option[];
  defaults?: SaasDefaults;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {businesses &&
        (businesses.length > 1 ? (
          <SelectField
            form={f}
            name="businessId"
            label="Business"
            errors={errors}
            options={businesses}
            className="sm:col-span-2"
          />
        ) : (
          <input type="hidden" name="businessId" value={businesses[0]?.value ?? ""} />
        ))}
      <InputField
        form={f}
        name="name"
        label="Project name"
        errors={errors}
        defaultValue={defaults?.name}
        maxLength={120}
        required
      />
      <SelectField
        form={f}
        name="stage"
        label="Stage"
        errors={errors}
        options={stages}
        defaultValue={defaults?.stage ?? "idea"}
      />
      <TextareaField
        form={f}
        name="summary"
        label="Summary"
        errors={errors}
        defaultValue={defaults?.summary}
        maxLength={2000}
        rows={2}
        className="sm:col-span-2"
      />
      <InputField
        form={f}
        name="repositoryUrl"
        label="Repository link (optional)"
        errors={errors}
        defaultValue={defaults?.repositoryUrl}
        type="url"
        placeholder="https://"
        hint="Stored as a link only; no code host is connected."
        className="sm:col-span-2"
      />
      <TextareaField
        form={f}
        name="requirements"
        label="Requirements"
        errors={errors}
        defaultValue={defaults?.requirements}
        maxLength={20000}
        rows={6}
        className="sm:col-span-2"
      />
    </div>
  );
}

export function NewSaasProjectForm({
  businesses,
  stages,
}: {
  businesses: Option[];
  stages: Option[];
}) {
  return (
    <RecordForm
      label="New software project"
      action={createSaasProjectAction}
      submitLabel="Add project"
      redirect={{ prefix: "/saas/", key: "projectId" }}
    >
      {(errors) => (
        <ProjectFields f="new-saas" errors={errors} businesses={businesses} stages={stages} />
      )}
    </RecordForm>
  );
}

export function EditSaasProjectForm({
  id,
  stages,
  defaults,
}: {
  id: string;
  stages: Option[];
  defaults: SaasDefaults;
}) {
  return (
    <RecordForm
      label="Edit project"
      action={(values) => updateSaasProjectAction(id, values)}
      submitLabel="Save changes"
    >
      {(errors) => (
        <ProjectFields f="edit-saas" errors={errors} stages={stages} defaults={defaults} />
      )}
    </RecordForm>
  );
}

export function BacklogItemForm({ projectId }: { projectId: string }) {
  const f = "backlog";
  return (
    <RecordForm
      label="New backlog item"
      action={(values) => addBacklogItemAction(projectId, values)}
      submitLabel="Add to backlog"
      after="reset"
    >
      {(errors) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <InputField
            form={f}
            name="title"
            label="Title"
            errors={errors}
            maxLength={200}
            className="sm:col-span-2"
            required
          />
          <SelectField
            form={f}
            name="type"
            label="Type"
            errors={errors}
            options={[
              { value: "feature", label: "Feature" },
              { value: "bug", label: "Bug" },
              { value: "chore", label: "Chore" },
            ]}
          />
          <SelectField
            form={f}
            name="priority"
            label="Priority"
            errors={errors}
            defaultValue="medium"
            options={[
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
          <TextareaField
            form={f}
            name="details"
            label="Details"
            errors={errors}
            maxLength={5000}
            rows={2}
            className="sm:col-span-4"
          />
        </div>
      )}
    </RecordForm>
  );
}

/** Moves a backlog item between to do, in progress and done. */
export function BacklogStatusSelect({
  itemId,
  status,
  title,
}: {
  itemId: string;
  status: string;
  title: string;
}) {
  const hydrated = useHydrated();
  const { pending, error, submit } = useFormAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Select
        aria-label={`Status of ${title}`}
        className="h-8 w-32 text-xs"
        defaultValue={status}
        disabled={!hydrated || pending}
        onChange={(e) => {
          const next = e.target.value as "todo" | "in_progress" | "done";
          submit(() => setBacklogStatusAction(itemId, next));
        }}
      >
        <option value="todo">To do</option>
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
      </Select>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
