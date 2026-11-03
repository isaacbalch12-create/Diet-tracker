import type { Equipment, ExerciseCategory, MuscleGroup } from './types';

export interface Seed {
  id: string;
  name: string;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  category: ExerciseCategory;
  instructions: string;
  isCustom: boolean;
  isFavorite: boolean;
  archived: boolean;
}

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function ex(
  name: string,
  primaryMuscle: MuscleGroup,
  secondaryMuscles: MuscleGroup[],
  equipment: Equipment,
  category: ExerciseCategory,
  instructions = '',
): Seed {
  return {
    // Built-in IDs are derived from the name and must never change: history,
    // templates and backups reference them.
    id: `bi-${slug(name)}`,
    name,
    primaryMuscle,
    secondaryMuscles,
    equipment,
    category,
    instructions,
    isCustom: false,
    isFavorite: false,
    archived: false,
  };
}

export const BUILT_IN_EXERCISES: Seed[] = [
  // Chest
  ex('Barbell Bench Press', 'chest', ['triceps', 'shoulders'], 'barbell', 'compound',
    'Lie on the bench with eyes under the bar. Retract shoulder blades, lower the bar to mid-chest under control, then press up and slightly back to lockout.'),
  ex('Incline Barbell Bench Press', 'chest', ['shoulders', 'triceps'], 'barbell', 'compound',
    'Set the bench to 30–45°. Lower the bar to the upper chest and press to lockout over the shoulders.'),
  ex('Decline Barbell Bench Press', 'chest', ['triceps'], 'barbell', 'compound'),
  ex('Close-Grip Bench Press', 'triceps', ['chest', 'shoulders'], 'barbell', 'compound',
    'Grip about shoulder-width, keep elbows tucked, lower to the lower chest and press.'),
  ex('Paused Bench Press', 'chest', ['triceps', 'shoulders'], 'barbell', 'compound',
    'Bench press with a 1–2 second motionless pause on the chest.'),
  ex('Dumbbell Bench Press', 'chest', ['triceps', 'shoulders'], 'dumbbell', 'compound',
    'Press dumbbells from chest level to lockout, keeping wrists stacked over elbows.'),
  ex('Incline Dumbbell Bench Press', 'chest', ['shoulders', 'triceps'], 'dumbbell', 'compound'),
  ex('Dumbbell Fly', 'chest', ['shoulders'], 'dumbbell', 'isolation',
    'With a slight bend in the elbows, open the arms in a wide arc until a stretch is felt, then bring the dumbbells together.'),
  ex('Incline Dumbbell Fly', 'chest', ['shoulders'], 'dumbbell', 'isolation'),
  ex('Machine Chest Press', 'chest', ['triceps', 'shoulders'], 'machine', 'compound'),
  ex('Smith Machine Bench Press', 'chest', ['triceps', 'shoulders'], 'smith machine', 'compound'),
  ex('Cable Crossover', 'chest', ['shoulders'], 'cable', 'isolation'),
  ex('Pec Deck', 'chest', ['shoulders'], 'machine', 'isolation'),
  ex('Push-Up', 'chest', ['triceps', 'shoulders', 'core'], 'bodyweight', 'compound',
    'Hands slightly wider than shoulders, body in a straight line. Lower chest to just above the floor and press back up.'),
  ex('Chest Dip', 'chest', ['triceps', 'shoulders'], 'bodyweight', 'compound',
    'Lean the torso forward and lower until the shoulders are slightly below the elbows, then press up.'),

  // Back
  ex('Deadlift', 'back', ['hamstrings', 'glutes', 'traps', 'forearms'], 'barbell', 'compound',
    'Bar over mid-foot, hinge to grip, brace hard, and stand up by driving the floor away while keeping the bar close.'),
  ex('Barbell Row', 'back', ['biceps', 'forearms'], 'barbell', 'compound',
    'Hinge to roughly 45°, pull the bar to the lower ribs, squeeze the shoulder blades, lower under control.'),
  ex('Pendlay Row', 'back', ['biceps'], 'barbell', 'compound'),
  ex('Dumbbell Row', 'back', ['biceps'], 'dumbbell', 'compound',
    'Brace on a bench, pull the dumbbell toward the hip, and lower until the arm is straight.'),
  ex('Chest-Supported Row', 'back', ['biceps'], 'dumbbell', 'compound'),
  ex('T-Bar Row', 'back', ['biceps'], 'barbell', 'compound'),
  ex('Seated Cable Row', 'back', ['biceps'], 'cable', 'compound'),
  ex('Machine Row', 'back', ['biceps'], 'machine', 'compound'),
  ex('Lat Pulldown', 'back', ['biceps'], 'cable', 'compound',
    'Pull the bar to the upper chest by driving the elbows down; control the return.'),
  ex('Close-Grip Lat Pulldown', 'back', ['biceps'], 'cable', 'compound'),
  ex('Pull-Up', 'back', ['biceps', 'forearms'], 'bodyweight', 'compound',
    'Overhand grip. Pull until the chin clears the bar, then lower to a full hang. Log added weight (0 for bodyweight).'),
  ex('Chin-Up', 'back', ['biceps'], 'bodyweight', 'compound'),
  ex('Straight-Arm Pulldown', 'back', [], 'cable', 'isolation'),
  ex('Rack Pull', 'back', ['traps', 'glutes', 'hamstrings'], 'barbell', 'compound'),
  ex('Back Extension', 'back', ['glutes', 'hamstrings'], 'bodyweight', 'isolation'),

  // Shoulders
  ex('Overhead Press', 'shoulders', ['triceps', 'core'], 'barbell', 'compound',
    'Standing, press the bar from the front of the shoulders to lockout overhead, moving the head out of the path.'),
  ex('Seated Dumbbell Shoulder Press', 'shoulders', ['triceps'], 'dumbbell', 'compound'),
  ex('Arnold Press', 'shoulders', ['triceps'], 'dumbbell', 'compound'),
  ex('Machine Shoulder Press', 'shoulders', ['triceps'], 'machine', 'compound'),
  ex('Push Press', 'shoulders', ['triceps', 'quads'], 'barbell', 'compound'),
  ex('Dumbbell Lateral Raise', 'shoulders', [], 'dumbbell', 'isolation',
    'Raise the dumbbells out to the sides to shoulder height with a slight elbow bend.'),
  ex('Cable Lateral Raise', 'shoulders', [], 'cable', 'isolation'),
  ex('Machine Lateral Raise', 'shoulders', [], 'machine', 'isolation'),
  ex('Front Raise', 'shoulders', [], 'dumbbell', 'isolation'),
  ex('Reverse Pec Deck', 'shoulders', ['back'], 'machine', 'isolation'),
  ex('Face Pull', 'shoulders', ['back', 'traps'], 'cable', 'isolation',
    'Pull the rope toward the face, elbows high, finishing with the hands beside the ears.'),
  ex('Bent-Over Reverse Fly', 'shoulders', ['back'], 'dumbbell', 'isolation'),
  ex('Upright Row', 'shoulders', ['traps'], 'barbell', 'compound'),

  // Traps
  ex('Barbell Shrug', 'traps', ['forearms'], 'barbell', 'isolation'),
  ex('Dumbbell Shrug', 'traps', ['forearms'], 'dumbbell', 'isolation'),

  // Biceps
  ex('Barbell Curl', 'biceps', ['forearms'], 'barbell', 'isolation',
    'Keep the elbows pinned at the sides and curl the bar to the shoulders without swinging.'),
  ex('EZ-Bar Curl', 'biceps', ['forearms'], 'ez bar', 'isolation'),
  ex('Dumbbell Curl', 'biceps', ['forearms'], 'dumbbell', 'isolation'),
  ex('Hammer Curl', 'biceps', ['forearms'], 'dumbbell', 'isolation'),
  ex('Incline Dumbbell Curl', 'biceps', [], 'dumbbell', 'isolation'),
  ex('Preacher Curl', 'biceps', [], 'ez bar', 'isolation'),
  ex('Cable Curl', 'biceps', ['forearms'], 'cable', 'isolation'),
  ex('Concentration Curl', 'biceps', [], 'dumbbell', 'isolation'),
  ex('Machine Curl', 'biceps', [], 'machine', 'isolation'),

  // Triceps
  ex('Triceps Pushdown', 'triceps', [], 'cable', 'isolation',
    'Elbows fixed at the sides, push the attachment down to full extension.'),
  ex('Rope Pushdown', 'triceps', [], 'cable', 'isolation'),
  ex('Overhead Cable Triceps Extension', 'triceps', [], 'cable', 'isolation'),
  ex('Skull Crusher', 'triceps', [], 'ez bar', 'isolation',
    'Lower the bar toward the forehead by bending only at the elbows, then extend.'),
  ex('Overhead Dumbbell Triceps Extension', 'triceps', [], 'dumbbell', 'isolation'),
  ex('Triceps Dip', 'triceps', ['chest', 'shoulders'], 'bodyweight', 'compound'),
  ex('Bench Dip', 'triceps', ['chest'], 'bodyweight', 'compound'),
  ex('Dumbbell Kickback', 'triceps', [], 'dumbbell', 'isolation'),

  // Forearms
  ex('Wrist Curl', 'forearms', [], 'dumbbell', 'isolation'),
  ex('Reverse Curl', 'forearms', ['biceps'], 'ez bar', 'isolation'),
  ex("Farmer's Carry", 'forearms', ['traps', 'core'], 'dumbbell', 'compound'),

  // Quads / legs
  ex('Barbell Back Squat', 'quads', ['glutes', 'hamstrings', 'core'], 'barbell', 'compound',
    'Bar on the upper back, brace, sit down between the hips to at least parallel, and drive back up.'),
  ex('Front Squat', 'quads', ['glutes', 'core'], 'barbell', 'compound'),
  ex('Pause Squat', 'quads', ['glutes', 'hamstrings'], 'barbell', 'compound'),
  ex('Goblet Squat', 'quads', ['glutes', 'core'], 'dumbbell', 'compound'),
  ex('Hack Squat', 'quads', ['glutes'], 'machine', 'compound'),
  ex('Leg Press', 'quads', ['glutes', 'hamstrings'], 'machine', 'compound',
    'Lower the sled until the knees reach about 90° or deeper without the lower back rounding, then press.'),
  ex('Smith Machine Squat', 'quads', ['glutes'], 'smith machine', 'compound'),
  ex('Bulgarian Split Squat', 'quads', ['glutes', 'hamstrings'], 'dumbbell', 'compound',
    'Rear foot on a bench, lower the back knee toward the floor, drive through the front foot. Log per-leg reps.'),
  ex('Walking Lunge', 'quads', ['glutes', 'hamstrings'], 'dumbbell', 'compound'),
  ex('Reverse Lunge', 'quads', ['glutes'], 'dumbbell', 'compound'),
  ex('Step-Up', 'quads', ['glutes'], 'dumbbell', 'compound'),
  ex('Leg Extension', 'quads', [], 'machine', 'isolation'),
  ex('Sissy Squat', 'quads', [], 'bodyweight', 'isolation'),

  // Hamstrings
  ex('Romanian Deadlift', 'hamstrings', ['glutes', 'back'], 'barbell', 'compound',
    'Soft knees, hinge at the hips pushing them back while the bar slides down the thighs, then stand tall.'),
  ex('Dumbbell Romanian Deadlift', 'hamstrings', ['glutes'], 'dumbbell', 'compound'),
  ex('Stiff-Leg Deadlift', 'hamstrings', ['glutes', 'back'], 'barbell', 'compound'),
  ex('Lying Leg Curl', 'hamstrings', [], 'machine', 'isolation'),
  ex('Seated Leg Curl', 'hamstrings', [], 'machine', 'isolation'),
  ex('Nordic Hamstring Curl', 'hamstrings', [], 'bodyweight', 'isolation'),
  ex('Good Morning', 'hamstrings', ['back', 'glutes'], 'barbell', 'compound'),

  // Glutes
  ex('Barbell Hip Thrust', 'glutes', ['hamstrings'], 'barbell', 'compound',
    'Upper back on a bench, bar over the hips. Drive the hips up to full extension and squeeze, then lower.'),
  ex('Glute Bridge', 'glutes', ['hamstrings'], 'barbell', 'compound'),
  ex('Sumo Deadlift', 'glutes', ['quads', 'hamstrings', 'back', 'adductors'], 'barbell', 'compound'),
  ex('Trap Bar Deadlift', 'glutes', ['quads', 'hamstrings', 'back'], 'trap bar', 'compound'),
  ex('Cable Kickback', 'glutes', [], 'cable', 'isolation'),
  ex('Hip Abduction Machine', 'glutes', [], 'machine', 'isolation'),
  ex('Hip Adduction Machine', 'adductors', [], 'machine', 'isolation'),
  ex('Kettlebell Swing', 'glutes', ['hamstrings', 'core'], 'kettlebell', 'compound'),

  // Calves
  ex('Standing Calf Raise', 'calves', [], 'machine', 'isolation',
    'Rise onto the balls of the feet as high as possible, pause, then lower into a full stretch.'),
  ex('Seated Calf Raise', 'calves', [], 'machine', 'isolation'),
  ex('Leg Press Calf Raise', 'calves', [], 'machine', 'isolation'),
  ex('Single-Leg Calf Raise', 'calves', [], 'dumbbell', 'isolation'),

  // Core
  ex('Plank', 'core', [], 'bodyweight', 'isolation',
    'Hold a straight line from head to heels. Log the hold in seconds in the reps field.'),
  ex('Hanging Leg Raise', 'core', [], 'bodyweight', 'isolation'),
  ex('Cable Crunch', 'core', [], 'cable', 'isolation'),
  ex('Ab Wheel Rollout', 'core', [], 'other', 'isolation'),
  ex('Crunch', 'core', [], 'bodyweight', 'isolation'),
  ex('Russian Twist', 'core', [], 'bodyweight', 'isolation'),
  ex('Pallof Press', 'core', [], 'cable', 'isolation'),
  ex('Decline Sit-Up', 'core', [], 'bodyweight', 'isolation'),

  // Full body
  ex('Power Clean', 'full body', ['traps', 'quads', 'glutes', 'hamstrings'], 'barbell', 'compound'),
  ex('Thruster', 'full body', ['quads', 'shoulders'], 'barbell', 'compound'),
];
