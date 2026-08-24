export function makeVisit({
  id,
  date,
  target = 100,
  nonTargetStatuses = {},
  newTargetMeasurements = {},
  newNonTargetStatuses = {},
  clinicalStable = true,
  createdAt
}) {
  const timestamp = createdAt || `${date}T08:00:00.000Z`;
  return {
    id,
    label: id,
    date,
    clinicalStable,
    notes: '',
    targetMeasurements: { t1: target },
    nonTargetStatuses,
    newTargetMeasurements,
    newNonTargetStatuses,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function makePatient({
  id = 'pt_test',
  mode = 'IRECIST',
  baselineMm = 100,
  baselineDate = '2026-01-01',
  visits = [],
  targetLesions,
  nonTargetLesions = [],
  newLesions = []
} = {}) {
  return {
    id,
    code: 'P001',
    mode,
    diagnosis: '',
    treatment: '',
    baselineDate,
    notes: '',
    targetLesions: targetLesions ?? [{
      id: 't1', label: 'T1', organ: '肝', location: '', isLymphNode: false, baselineMm
    }],
    nonTargetLesions,
    newLesions,
    visits,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

export function makeState(patient) {
  return {
    schemaVersion: 1,
    settings: {
      studyName: 'Test', protocol: '', assessor: '', defaultMode: 'IRECIST'
    },
    patients: patient ? [patient] : [],
    audit: []
  };
}
