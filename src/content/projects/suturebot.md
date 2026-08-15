---
title: Suturebot
period: '2026'
section: research
order: 10
href: https://github.com/adarshambati1/Suturebot
summary: >-
  Autonomous surgical suturing on a single 7-DOF arm with a static 3D-printed
  end-effector — no second arm, no surgical wrist, no proprietary instruments.
  A da Vinci runs about $1.5M; the question is how much of the task survives at
  roughly one percent of that. CS 225A.
---

## The constraint is the point

Suturing is one of the most common procedures in medicine and one of the most
tedious. The standard robotic platform for it is the da Vinci Surgical System —
three or four teleoperated arms and proprietary instruments, roughly $1.5M
before maintenance and per-procedure consumables. That price is why robotic
suturing is largely confined to large urban academic centres.

Most academic work inherits the same hardware assumption. Berkeley's AUTOLAB
builds on the dVRK, the research version of da Vinci. Johns Hopkins' STAR uses a
custom multi-arm platform with purpose-built suturing tools. Both lines of work
are excellent, and both are expensive to reproduce — which puts the cost of the
platform between the research and any broad deployment.

Suturebot asks a different question: how far can you get with one standard 7-DOF
industrial arm and a few dollars of printed plastic? The novelty isn't the
algorithms. It's the constraint. Single arm, no actuated gripper, off-the-shelf
research robot, printed end-effector — everything expensive removed, and the
system still has to work.

## How it differs from prior work

STAR is single-arm in execution but still depends on a custom platform, infrared
fiducials placed in tissue, and purpose-built tooling. Compared to the Berkeley
line of work we trade dexterity for cost and reproducibility: no second arm, no
surgical wrist, no proprietary instruments, no fiducials. The closest published
prior work is a 2023 single-arm autonomous suturing system, which still used
surgical-grade tooling.

## System

One 7-DOF arm with a static end-effector mounted at the flange. The needle is
pre-loaded into the holder before the run, and the arm uses its redundancy to
handle the orientation changes a fixed gripper can't absorb on its own.
