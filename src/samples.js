export const samples = [
  {
    id: 'syn-2201',
    title: 'SYN-2201 · Sore throat',
    blurb: 'Fictional adult visit. Allergies, a medicine, and vitals are all in the transcript.',
    text: `[SYNTHETIC SAMPLE SYN-2201 — fictional visit, not a real patient]
Clinician: Good morning, Rowan. What brings you in today?
Patient: My throat has been burning since Monday, and it hurts when I swallow. I felt hot last night.
Clinician: Any cough, congestion, or trouble breathing?
Patient: A dry cough and a stuffy nose. Breathing is fine.
Clinician: Have you taken any medicine?
Patient: Ibuprofen 200 mg this morning. It dulled the pain for a few hours.
Clinician: Any allergies to medicines?
Patient: Penicillin gives me a rash. I do not know of any other drug allergy.
Clinician: Vitals today are temperature 100.4 Fahrenheit, blood pressure 118/74, heart rate 88, respiratory rate 16, and oxygen saturation 98 percent on room air. Your throat is red without white patches, the neck nodes are mildly tender, and the lungs are clear.
Patient: Is it strep?
Clinician: This pattern fits a viral sore throat. Rest, fluids, and ibuprofen as needed. I am not prescribing an antibiotic today. Come back if you cannot swallow liquids, you develop a rash, or the fever is still there after five days.`,
  },
  {
    id: 'syn-2202',
    title: 'SYN-2202 · Blood pressure follow-up',
    blurb: 'Fictional adult follow-up. A medicine and vitals are present. Allergies are not mentioned.',
    text: `[SYNTHETIC SAMPLE SYN-2202 — fictional visit, not a real patient]
Clinician: Casey, this is a blood-pressure follow-up. How have the last few weeks felt?
Patient: Mostly all right. I get a dull afternoon headache, and I skip the morning pill a couple of times a week.
Clinician: The prescribed medicine is lisinopril 10 mg daily. Any cough, swelling, or dizziness?
Patient: A dry cough at night sometimes. No swelling and no dizziness.
Clinician: Blood pressure today is 148/92 and heart rate is 76. Weight is 182 pounds.
Patient: That is higher than my last visit.
Clinician: Keep lisinopril, and write a home blood-pressure log each morning and evening for two weeks. We can talk about the dose after that log. Seek urgent care for chest pain, fainting, or a severe headache.`,
  },
  {
    id: 'syn-2203',
    title: 'SYN-2203 · Rolled ankle',
    blurb: 'Fictional adult injury visit. Allergies, medicines, and vitals are not mentioned.',
    text: `[SYNTHETIC SAMPLE SYN-2203 — fictional visit, not a real patient]
Clinician: Jules, what happened to the ankle?
Patient: I stepped off a curb at a rec-league game yesterday and rolled my right ankle. I walked off, but it swelled up.
Clinician: Can you bear weight today? Any numbness, or did you hear a pop?
Patient: I can take a few limping steps. No numbness. I did not hear a pop. The outside of the ankle is the worst spot.
Clinician: The right lateral ankle is swollen and tender over the anterior talofibular area. There is no bony tenderness along the malleoli, so I am not ordering x-rays from this exam.
Patient: Do I need a boot?
Clinician: Use a lace-up brace, rest, ice, compression, and elevation for a few days, and start gentle motion as the pain allows. Follow up if you cannot walk four steps or the swelling is worse in a week.`,
  },
  {
    id: 'syn-2204',
    title: 'SYN-2204 · Diabetes check-in',
    blurb: 'Fictional adult visit. Allergies and a medicine are present. Clinic vitals are not.',
    text: `[SYNTHETIC SAMPLE SYN-2204 — fictional visit, not a real patient]
Clinician: Noor, how is the diabetes medicine treating you?
Patient: I take metformin 500 mg twice a day. My stomach was upset the first week and then settled. I have no known drug allergies.
Clinician: Any low blood sugar, extra thirst, or blurry vision?
Patient: I am thirsty in the evenings. No shaking, no sweating, and my vision is unchanged.
Clinician: What do the home glucose checks look like?
Patient: Fasting has been about 140 to 160. After dinner it is closer to 190.
Clinician: Continue metformin, walk about ten minutes after dinner, and keep the log. If fasting stays above 150 we will talk about the next step. Seek care for vomiting, confusion, or a glucose under 70.`,
  },
  {
    id: 'syn-2205',
    title: 'SYN-2205 · Afternoon headaches',
    blurb: 'Fictional adult visit. Vitals are present. Allergies and medicines are not mentioned.',
    text: `[SYNTHETIC SAMPLE SYN-2205 — fictional visit, not a real patient]
Clinician: Samir, tell me about the headaches.
Patient: For three weeks I have had a tight band around my head by late afternoon. It is worse when I stay on the laptop.
Clinician: Does it wake you, or come with weakness, vision loss, or vomiting?
Patient: No. It is on both sides, and it eases if I step away from the screen. It is not the worst headache of my life.
Clinician: Any recent head injury?
Patient: No.
Clinician: Blood pressure is 122/78, heart rate is 72, and temperature is 98.2 Fahrenheit. The pattern fits a tension-type headache. Try scheduled screen breaks and a regular bedtime, and follow up if the pattern changes. Seek urgent care for sudden severe pain, weakness, or confusion.`,
  },
];

export function sampleById(id) {
  return samples.find((sample) => sample.id === id) || null;
}
