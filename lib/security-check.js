// Tender-security instrument checker.
// The security clause is short, precise, and the most expensive thing to get wrong:
// a guarantee in the wrong form or with a validity that expires before the deadline
// is rejected regardless of how good the bid is.

import { formatBDT } from './rules.js'

const DAILY = 86400000

function isHigh(i) {
  return i.severity === 'high'
}

function dayOf(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function checkInstrument(instrument, { security, submission }) {
  const issues = []
  const required = Number(security?.amount_bdt)
  const amount = Number(String(instrument?.amount ?? '').replace(/[,\s৳]/g, ''))

  if (!Number.isFinite(amount) || amount <= 0) {
    issues.push({ code: 'amount_missing', severity: 'high', message: 'Face value is missing or not a number.' })
  } else if (amount < required) {
    issues.push({
      code: 'amount_short',
      severity: 'high',
      message: `Face value ${formatBDT(amount)} is short of the required ${formatBDT(required)}.`,
    })
  } else if (amount > required) {
    issues.push({
      code: 'amount_over',
      severity: 'low',
      message: `Face value ${formatBDT(amount)} exceeds the required ${formatBDT(required)}; confirm the entity accepts an over-secured instrument.`,
    })
  }

  const allowed = String(security?.form || '')
    .toLowerCase()
    .split(/\bor\b/)
    .map((s) => s.trim())
    .filter(Boolean)
  const form = String(instrument?.form || '').toLowerCase().trim()
  if (!form) {
    issues.push({ code: 'form_missing', severity: 'high', message: 'Instrument form is missing.' })
  } else if (allowed.length && !allowed.some((a) => form.includes(a) || a.includes(form))) {
    issues.push({
      code: 'form_wrong',
      severity: 'high',
      message: `“${instrument.form}” is not one of the accepted forms: ${security.form}.`,
    })
  }

  const payeeRequired = String(security?.payee || '').toLowerCase().match(/[a-z]+/g) || []
  const payeeGiven = String(instrument?.payee || '').toLowerCase().match(/[a-z]+/g) || []
  if (!payeeGiven.length) {
    issues.push({ code: 'payee_missing', severity: 'high', message: 'The instrument must name the payee.' })
  } else if (payeeRequired.length) {
    const given = new Set(payeeGiven)
    const hits = payeeRequired.filter((t) => given.has(t)).length
    if (hits / payeeRequired.length < 0.7) {
      issues.push({
        code: 'payee_mismatch',
        severity: 'high',
        message: `In favour of “${instrument.payee}” but the clause names ${security.payee}.`,
      })
    }
  }

  if (!instrument?.valid_until) {
    issues.push({ code: 'validity_missing', severity: 'high', message: 'Validity end date is missing.' })
  } else if (submission?.deadline) {
    const need = new Date(new Date(submission.deadline).getTime() + Number(security.validity_days || 0) * DAILY)
    const until = new Date(instrument.valid_until)
    if (Number.isNaN(until.getTime())) {
      issues.push({ code: 'validity_invalid', severity: 'high', message: 'Validity end date is not a valid date.' })
    } else if (dayOf(until) < dayOf(need)) {
      // Day granularity: an instrument valid *on* the final required day is valid.
      issues.push({
        code: 'validity_short',
        severity: 'high',
        message: `Valid until ${instrument.valid_until} but the clause requires validity through ${need.toISOString().slice(0, 10)} (deadline + ${security.validity_days} days).`,
      })
    }
  }

  return {
    ok: !issues.some(isHigh),
    checked: { amount: Number.isFinite(amount) ? amount : null, form: instrument?.form ?? null, payee: instrument?.payee ?? null, valid_until: instrument?.valid_until ?? null },
    requirements: {
      amount: required,
      form: security?.form,
      payee: security?.payee,
      validity_days: security?.validity_days,
    },
    issues,
  }
}
