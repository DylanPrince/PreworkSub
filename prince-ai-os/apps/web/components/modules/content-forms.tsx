"use client";
import {
  createContentAction,
  markContentPublishedAction,
  requestContentApprovalAction,
  updateContentAction,
} from "@/lib/module-actions";
import { InputField, SelectField, TextareaField, type FieldErrors } from "./field";
import type { Option } from "./options";
import { RecordForm } from "./record-form";

export interface ContentDefaults {
  title: string;
  format: string;
  channel: string;
  brief: string;
  body: string;
}

function ContentFields({
  f,
  errors,
  businesses,
  formats,
  defaults,
  withBody,
}: {
  f: string;
  errors: FieldErrors;
  businesses?: Option[];
  formats: Option[];
  defaults?: ContentDefaults;
  withBody: boolean;
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
        name="title"
        label="Title"
        errors={errors}
        defaultValue={defaults?.title}
        maxLength={200}
        className="sm:col-span-2"
        required
      />
      <SelectField
        form={f}
        name="format"
        label="Format"
        errors={errors}
        options={formats}
        defaultValue={defaults?.format ?? "social_post"}
      />
      <InputField
        form={f}
        name="channel"
        label="Channel"
        errors={errors}
        defaultValue={defaults?.channel}
        maxLength={80}
        placeholder="e.g. Instagram, newsletter, blog"
      />
      <TextareaField
        form={f}
        name="brief"
        label="Brief"
        errors={errors}
        defaultValue={defaults?.brief}
        maxLength={5000}
        hint="Goal, audience and key points. Agents use it when drafting."
        className="sm:col-span-2"
      />
      {withBody && (
        <TextareaField
          form={f}
          name="body"
          label="Text to publish"
          errors={errors}
          defaultValue={defaults?.body}
          maxLength={50000}
          hint="This exact text is what an approver signs off. Editing it later cancels the approval."
          className="sm:col-span-2"
          rows={10}
        />
      )}
    </div>
  );
}

export function NewContentForm({
  businesses,
  formats,
}: {
  businesses: Option[];
  formats: Option[];
}) {
  return (
    <RecordForm
      label="New content item"
      action={createContentAction}
      submitLabel="Add idea"
      redirect={{ prefix: "/content/", key: "contentId" }}
    >
      {(errors) => (
        <ContentFields
          f="new-content"
          errors={errors}
          businesses={businesses}
          formats={formats}
          withBody={false}
        />
      )}
    </RecordForm>
  );
}

export function EditContentForm({
  id,
  formats,
  defaults,
}: {
  id: string;
  formats: Option[];
  defaults: ContentDefaults;
}) {
  return (
    <RecordForm
      label="Edit content"
      action={(values) => updateContentAction(id, values)}
      submitLabel="Save changes"
    >
      {(errors) => (
        <ContentFields
          f="edit-content"
          errors={errors}
          formats={formats}
          defaults={defaults}
          withBody
        />
      )}
    </RecordForm>
  );
}

export function RequestContentApprovalForm({ id }: { id: string }) {
  return (
    <RecordForm
      label="Request approval to publish"
      action={(values) => requestContentApprovalAction(id, values)}
      submitLabel="Request approval"
    >
      {(errors) => (
        <InputField
          form="content-approval"
          name="scheduledFor"
          label="Planned publication date (optional)"
          errors={errors}
          type="date"
          className="max-w-56"
        />
      )}
    </RecordForm>
  );
}

export function MarkPublishedForm({ id }: { id: string }) {
  return (
    <RecordForm
      label="Record publication"
      action={(values) => markContentPublishedAction(id, values)}
      submitLabel="Mark as published"
    >
      {(errors) => (
        <InputField
          form="content-published"
          name="publishedUrl"
          label="Link to the published item (optional)"
          errors={errors}
          type="url"
          placeholder="https://"
        />
      )}
    </RecordForm>
  );
}
